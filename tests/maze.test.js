// Zero-dependency unit tests for the Maze Mode layout + validation logic.
// Run with:  node tests/maze.test.js
//
// Covers the PRD's required cases: geometry validity, spawn safety, wall
// collision lookup, deterministic layout loading, locked-region rejection, and
// Classic Mode compatibility (no internal walls).

var SnakeMaze = require('../maze.js');

var passed = 0;
var failures = [];

function check(name, cond) {
  if (cond) {
    passed++;
  } else {
    failures.push(name);
    console.error('FAIL: ' + name);
  }
}

function cellSet(cells) {
  var set = {};
  cells.forEach(function (c) { set[c.x + ',' + c.y] = true; });
  return set;
}

// --- Deterministic layout loading ---
var arenaA = SnakeMaze.cellsFor('arena');
var arenaB = SnakeMaze.cellsFor('arena');
check('arena layout is non-empty', arenaA.length > 0);
check('arena layout loads deterministically (same cells each time)',
  JSON.stringify(arenaA) === JSON.stringify(arenaB));

// --- Geometry validity: in-bounds + unique ---
var inBounds = arenaA.every(function (c) {
  return c.x >= 0 && c.y >= 0 && c.x < SnakeMaze.COLS && c.y < SnakeMaze.ROWS;
});
check('arena walls are all in bounds', inBounds);

var unique = Object.keys(cellSet(arenaA)).length === arenaA.length;
check('arena walls contain no duplicates', unique);

// --- The curated arena passes validation ---
var arenaResult = SnakeMaze.validateLayout(arenaA);
check('arena passes playability validation', arenaResult.ok === true);
check('arena reports open-cell count', arenaResult.openCells === SnakeMaze.COLS * SnakeMaze.ROWS - arenaA.length);

// --- Spawn safety: the central cross is clear ---
var arenaSet = cellSet(arenaA);
check('spawn cell is clear', !arenaSet[SnakeMaze.SPAWN.x + ',' + SnakeMaze.SPAWN.y]);
var forwardClear = true;
for (var f = 1; f <= SnakeMaze.FORWARD_BUFFER; f++) {
  if (arenaSet[(SnakeMaze.SPAWN.x + f) + ',' + SnakeMaze.SPAWN.y]) {
    forwardClear = false;
  }
}
check('forward path ahead of spawn is clear', forwardClear);

// --- Wall collision lookup works against the loaded set ---
check('a known arena wall cell is detected as a wall', arenaSet['5,5'] === true);
check('the spawn cell is not detected as a wall', arenaSet['10,10'] !== true);

// --- Validation rejects bad layouts ---
check('rejects out-of-bounds walls',
  SnakeMaze.validateLayout([{ x: -1, y: 0 }]).ok === false);
check('rejects non-integer walls',
  SnakeMaze.validateLayout([{ x: 1.5, y: 2 }]).ok === false);
check('rejects duplicate/overlapping walls',
  SnakeMaze.validateLayout([{ x: 3, y: 3 }, { x: 3, y: 3 }]).ok === false);
check('rejects a wall on the spawn cell',
  SnakeMaze.validateLayout([{ x: SnakeMaze.SPAWN.x, y: SnakeMaze.SPAWN.y }]).ok === false);
check('rejects a wall blocking the immediate forward path',
  SnakeMaze.validateLayout([{ x: SnakeMaze.SPAWN.x + 1, y: SnakeMaze.SPAWN.y }]).ok === false);

// A fully enclosed single cell = a locked region -> must be rejected. Box a
// corner cell (2,2) in with its orthogonal neighbours so nothing can reach it.
var lockedRegion = [
  { x: 2, y: 1 }, { x: 1, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }
];
check('rejects layouts that lock off a region',
  SnakeMaze.validateLayout(lockedRegion).ok === false);

// A layout that walls off almost everything -> below the minimum open area.
var tooDense = [];
for (var x = 0; x < SnakeMaze.COLS; x++) {
  for (var y = 0; y < SnakeMaze.ROWS; y++) {
    // leave only the spawn + its forward run open; wall the rest
    if (!(y === SnakeMaze.SPAWN.y && x >= SnakeMaze.SPAWN.x - 3)) {
      tooDense.push({ x: x, y: y });
    }
  }
}
check('rejects layouts below the minimum navigable area',
  SnakeMaze.validateLayout(tooDense).ok === false);

// --- Classic Mode compatibility: no internal walls, still valid ---
check('Classic Mode has zero internal walls', SnakeMaze.CLASSIC.length === 0);
check('unknown/Classic layout id yields no walls', SnakeMaze.cellsFor('classic').length === 0);
var classicResult = SnakeMaze.validateLayout(SnakeMaze.CLASSIC);
check('empty (Classic) layout passes validation', classicResult.ok === true);
check('Classic layout leaves the whole board open',
  classicResult.openCells === SnakeMaze.COLS * SnakeMaze.ROWS);

// --- Summary ---
if (failures.length) {
  console.error('\n' + failures.length + ' test(s) failed, ' + passed + ' passed.');
  process.exit(1);
}
console.log('All ' + passed + ' maze tests passed.');
