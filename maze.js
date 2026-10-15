// ---- Maze Mode: layouts + playability validation ----
//
// This module is intentionally kept separate from index.html so the layout data
// and the validation rules are pure, side-effect-free, and unit-testable under
// Node (see tests/maze.test.js). The browser loads it with a plain <script> tag
// (exposing window.SnakeMaze); Node loads it with require().
//
// Coordinates here are GRID CELLS (0..COLS-1, 0..ROWS-1), not pixels. index.html
// multiplies by the grid size when it renders/collides.
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.SnakeMaze = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Board geometry. Mirrors index.html: canvas 400x400 at a 16px grid = 25x25.
  var GRID = 16;
  var COLS = 25;
  var ROWS = 25;

  // Spawn model, kept in sync with index.html's resetGame():
  // the head starts at cell (10,10) (pixel 160,160) moving right, and the snake
  // is 4 cells long, so the body trails back along -dir from the head.
  var SPAWN = { x: 10, y: 10 };
  var SPAWN_DIR = { x: 1, y: 0 };
  var SPAWN_LENGTH = 4;

  // Fairness thresholds (documented product decisions for the MVP):
  // - FORWARD_BUFFER: clear cells required directly ahead of the spawn so the
  //   player always has reaction time before the first obstacle.
  // - MIN_OPEN_FRACTION: minimum share of the board that must stay navigable.
  var FORWARD_BUFFER = 6;
  var MIN_OPEN_FRACTION = 0.5;

  function key(cell) {
    return cell.x + ',' + cell.y;
  }

  function isInt(n) {
    return typeof n === 'number' && isFinite(n) && Math.floor(n) === n;
  }

  // Grid neighbours WITH edge wrapping, matching the game's wrap-around board so
  // the reachability check reflects how the snake can actually travel.
  function neighbors(cell, cols, rows) {
    return [
      { x: (cell.x + 1) % cols, y: cell.y },
      { x: (cell.x - 1 + cols) % cols, y: cell.y },
      { x: cell.x, y: (cell.y + 1) % rows },
      { x: cell.x, y: (cell.y - 1 + rows) % rows }
    ];
  }

  // Curated MVP layout: the "Arena" — a rectangular inner wall ring with four
  // doorway gaps aligned to the spawn row and column. This keeps the central
  // cross (spawn row + spawn column) completely clear, guarantees a safe spawn
  // and all four escape routes, while still forcing route decisions (which gap
  // to take) for replay variety. Returns a de-duplicated list of unique cells.
  function buildArena(cols, rows) {
    var left = 5;
    var right = cols - 6;   // 19 on a 25-wide board
    var top = 5;
    var bottom = rows - 6;  // 19 rows -> 15
    var gapCol = SPAWN.x;   // doorway in the top & bottom walls
    var gapRow = SPAWN.y;   // doorway in the left & right walls

    var seen = {};
    var cells = [];
    function add(x, y) {
      var k = x + ',' + y;
      if (!seen[k]) {
        seen[k] = true;
        cells.push({ x: x, y: y });
      }
    }

    var x, y;
    for (x = left; x <= right; x++) {
      if (x !== gapCol) {
        add(x, top);
        add(x, bottom);
      }
    }
    for (y = top; y <= bottom; y++) {
      if (y !== gapRow) {
        add(left, y);
        add(right, y);
      }
    }
    return cells;
  }

  // Registry of selectable layouts. `build(cols, rows)` returns wall cells.
  // Add presets here (same shape) without touching the game rules.
  var LAYOUTS = {
    arena: { id: 'arena', name: 'Arena', build: buildArena }
  };

  // Classic Mode = no internal walls. Exported so callers have one source of
  // truth and tests can assert Classic stays wall-free.
  var CLASSIC = [];

  // Return the wall cells for a layout id. Unknown ids (including the Classic
  // sentinel) return an empty array.
  function cellsFor(layoutId, cols, rows) {
    cols = cols || COLS;
    rows = rows || ROWS;
    var layout = LAYOUTS[layoutId];
    if (!layout) {
      return CLASSIC.slice();
    }
    return layout.build(cols, rows);
  }

  function fail(reason) {
    return { ok: false, reason: reason };
  }

  // Validate a layout BEFORE it is allowed into a run. Returns
  // { ok: true, reason: 'ok', openCells: N } or { ok: false, reason: '...' }.
  // Rules enforced:
  //   1. Every wall cell is an integer inside the board bounds.
  //   2. No duplicate / overlapping wall cells.
  //   3. The spawn footprint (head + trailing body + a one-cell buffer) and the
  //      forward path are clear, so the player is never trapped or killed at spawn.
  //   4. No locked-off regions: every open cell must be reachable from the spawn.
  //   5. Enough of the board stays navigable (MIN_OPEN_FRACTION).
  function validateLayout(cells, opts) {
    opts = opts || {};
    var cols = opts.cols || COLS;
    var rows = opts.rows || ROWS;
    var spawn = opts.spawn || SPAWN;
    var dir = opts.dir || SPAWN_DIR;
    var length = opts.spawnLength || SPAWN_LENGTH;
    var forward = typeof opts.forwardBuffer === 'number' ? opts.forwardBuffer : FORWARD_BUFFER;
    var minOpen = typeof opts.minOpenFraction === 'number' ? opts.minOpenFraction : MIN_OPEN_FRACTION;

    if (!cells || typeof cells.length !== 'number') {
      return fail('layout is not a list of cells');
    }

    // 1 + 2: bounds and overlap
    var wall = {};
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (!c || !isInt(c.x) || !isInt(c.y)) {
        return fail('wall cell at index ' + i + ' is not an integer coordinate');
      }
      if (c.x < 0 || c.y < 0 || c.x >= cols || c.y >= rows) {
        return fail('wall out of bounds at (' + c.x + ',' + c.y + ')');
      }
      var k = key(c);
      if (wall[k]) {
        return fail('duplicate/overlapping wall at (' + c.x + ',' + c.y + ')');
      }
      wall[k] = true;
    }

    // 3: spawn safety — collect every cell that must be clear at game start
    var required = {};
    function need(x, y) {
      required[((x % cols) + cols) % cols + ',' + (((y % rows) + rows) % rows)] = true;
    }
    need(spawn.x, spawn.y);
    // trailing body behind the head (opposite the travel direction)
    for (var b = 1; b < length; b++) {
      need(spawn.x - dir.x * b, spawn.y - dir.y * b);
    }
    // one-cell buffer box around the head
    for (var dx = -1; dx <= 1; dx++) {
      for (var dy = -1; dy <= 1; dy++) {
        need(spawn.x + dx, spawn.y + dy);
      }
    }
    // clear run directly ahead of the head
    for (var f = 1; f <= forward; f++) {
      need(spawn.x + dir.x * f, spawn.y + dir.y * f);
    }
    for (var rk in required) {
      if (wall[rk]) {
        return fail('wall overlaps a required spawn/forward-path cell (' + rk + ')');
      }
    }

    // 4: reachability — flood fill free cells from the spawn (with wrap)
    var totalFree = cols * rows - cells.length;
    var seen = {};
    var stack = [{ x: spawn.x, y: spawn.y }];
    seen[key(spawn)] = true;
    var reached = 0;
    while (stack.length) {
      var cur = stack.pop();
      reached++;
      var ns = neighbors(cur, cols, rows);
      for (var n = 0; n < ns.length; n++) {
        var nk = key(ns[n]);
        if (!seen[nk] && !wall[nk]) {
          seen[nk] = true;
          stack.push(ns[n]);
        }
      }
    }
    if (reached !== totalFree) {
      return fail('layout locks off ' + (totalFree - reached) + ' open cell(s) from the spawn');
    }

    // 5: minimum navigable space
    if (totalFree / (cols * rows) < minOpen) {
      return fail('navigable area ' + totalFree + '/' + (cols * rows) + ' is below the minimum');
    }

    return { ok: true, reason: 'ok', openCells: totalFree };
  }

  return {
    GRID: GRID,
    COLS: COLS,
    ROWS: ROWS,
    SPAWN: SPAWN,
    SPAWN_DIR: SPAWN_DIR,
    SPAWN_LENGTH: SPAWN_LENGTH,
    FORWARD_BUFFER: FORWARD_BUFFER,
    MIN_OPEN_FRACTION: MIN_OPEN_FRACTION,
    LAYOUTS: LAYOUTS,
    CLASSIC: CLASSIC,
    cellsFor: cellsFor,
    validateLayout: validateLayout,
    key: key,
    neighbors: neighbors
  };
});
