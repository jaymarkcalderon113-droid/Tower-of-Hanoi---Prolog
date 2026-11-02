// app.js -- Tower of Hanoi frontend (vanilla JavaScript)
//
// The browser does NOT know the rules. It only:
//   1. sends the player's move to the Prolog server,
//   2. draws whatever game state the server sends back.
//
// Safety: text is put on the page with textContent (never innerHTML),
// so nothing the server sends can be run as HTML/JavaScript.

'use strict';

const PEGS = ['A', 'B', 'C'];
let state = null;       // the latest game state from the server
let selected = null;    // peg the player clicked first (or null)
let busy = false;       // true while auto-solve is running
let dragFrom = null;    // peg a disk is being dragged from (or null)

const statusBox = document.getElementById('status');
const winBox = document.getElementById('win');

// ---- talking to the server -----------------------------------------

// callApi(method, url, body): send a request, return the JSON answer.
// If the server answers with an error (400, 409...), we throw its message.
async function callApi(method, url, body) {
  const options = { method: method, headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error);
  }
  return data;
}

// showMessage(text, isError): write a message under the buttons.
function showMessage(text, isError) {
  statusBox.textContent = text;
  statusBox.classList.toggle('error', isError === true);
}

// ---- drawing ----------------------------------------------------------

// draw(): redraw everything from `state`.
function draw() {
  document.getElementById('move-count').textContent = state.moves;
  document.getElementById('min-moves').textContent = state.minMoves;
  document.getElementById('disk-count').value = state.disks;
  document.getElementById('board').style.setProperty('--n', state.disks);

  for (const name of PEGS) {
    const pegDiv = document.querySelector('.peg[data-peg="' + name + '"]');
    const stack = pegDiv.querySelector('.stack');
    stack.replaceChildren();                       // remove old disks

    const disks = state.pegs[name];                // bottom disk first
    disks.forEach(function (size, index) {
      const disk = document.createElement('div');
      disk.className = 'disk d' + size;            // d1..d8 = colour
      disk.style.setProperty('--size', size);      // controls the width
      disk.textContent = size;                     // the number on the disk
      if (index === disks.length - 1) {            // top disk only
        disk.classList.add('top');
        disk.draggable = true;                     // can be dragged
      }
      stack.appendChild(disk);
    });

    pegDiv.setAttribute('aria-pressed', String(selected === name));
    pegDiv.setAttribute('aria-label', 'Peg ' + name + ', ' + disks.length + ' disks');
  }

  winBox.hidden = !state.solved;
  if (state.solved) {
    winBox.textContent = 'You solved it in ' + state.moves +
      ' moves! (minimum possible: ' + state.minMoves + ')';
  }
}

// ---- playing ----------------------------------------------------------

// move(from, to): ask the server to make the move, then redraw.
async function move(from, to) {
  try {
    state = await callApi('POST', '/api/move', { from: from, to: to });
    showMessage('Moved ' + from + ' to ' + to + '.', false);
  } catch (error) {
    showMessage(error.message, true);     // e.g. "illegal move ..."
  }
  draw();
}

// clickPeg(name): first click picks a peg, second click drops on a peg.
function clickPeg(name) {
  if (busy) { return; }
  if (selected === null) {
    selected = name;                      // pick up
    draw();
  } else {
    const from = selected;
    selected = null;                      // put down
    if (from === name) {
      draw();                             // clicked the same peg: cancel
    } else {
      move(from, name);
    }
  }
}

// newGame(): start a fresh game with the chosen number of disks.
async function newGame() {
  if (busy) { return; }
  const n = parseInt(document.getElementById('disk-count').value, 10);
  selected = null;
  try {
    state = await callApi('POST', '/api/reset', { disks: n });
    showMessage('New game with ' + n + ' disks. Move them all to peg C.', false);
  } catch (error) {
    showMessage(error.message, true);
  }
  draw();
}

// autoSolve(): get the solution from Prolog and play it step by step.
async function autoSolve() {
  if (busy) { return; }
  busy = true;
  try {
    await newGame2();                                   // start fresh
    const plan = await callApi('GET', '/api/solve?disks=' + state.disks);
    for (const step of plan.moves) {
      await new Promise(function (done) { setTimeout(done, 400); });  // pause
      state = await callApi('POST', '/api/move', { from: step.from, to: step.to });
      draw();
    }
    showMessage('Auto-solve finished!', false);
  } catch (error) {
    showMessage(error.message, true);
  }
  busy = false;
}

// helper for autoSolve: reset with the current disk count
async function newGame2() {
  state = await callApi('POST', '/api/reset', { disks: state.disks });
  draw();
}

// ---- connecting the page to the functions above -------------------------

for (const name of PEGS) {
  const pegDiv = document.querySelector('.peg[data-peg="' + name + '"]');

  pegDiv.addEventListener('click', function () { clickPeg(name); });

  // keyboard: Enter or Space acts like a click
  pegDiv.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      clickPeg(name);
    }
  });

  // drag and drop: the dragged disk's source peg is remembered
  pegDiv.addEventListener('dragstart', function () {
    if (!busy) { dragFrom = name; }
  });
  pegDiv.addEventListener('dragover', function (event) {
    event.preventDefault();               // allow dropping here
  });
  pegDiv.addEventListener('drop', function (event) {
    event.preventDefault();
    if (dragFrom !== null && dragFrom !== name && !busy) {
      selected = null;
      move(dragFrom, name);
    }
    dragFrom = null;
  });
}

document.getElementById('reset-btn').addEventListener('click', newGame);
document.getElementById('disk-count').addEventListener('change', newGame);
document.getElementById('solve-btn').addEventListener('click', autoSolve);

// start: load the current game from the server
(async function start() {
  try {
    state = await callApi('GET', '/api/state');
    draw();
    showMessage('Move all disks from peg A to peg C.', false);
  } catch (error) {
    showMessage('Cannot reach the server. Is server.pl running?', true);
  }
})();
