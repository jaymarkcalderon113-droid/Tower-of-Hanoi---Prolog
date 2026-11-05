'use strict';

const PEGS = ['A', 'B', 'C'];
let state = null;
let selected = null;
let busy = false;
let dragFrom = null;
let animating = false;

const statusBox = document.getElementById('status');
const winBox = document.getElementById('win');

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

function showMessage(text, isError) {
  statusBox.textContent = text;
  statusBox.classList.toggle('error', isError === true);
}

function draw() {
  document.getElementById('move-count').textContent = state.moves;
  document.getElementById('min-moves').textContent = state.minMoves;
  document.getElementById('disk-count').value = state.disks;
  document.getElementById('board').style.setProperty('--n', state.disks);

  for (const name of PEGS) {
    const pegDiv = document.querySelector('.peg[data-peg="' + name + '"]');
    const stack = pegDiv.querySelector('.stack');
    stack.replaceChildren();

    const disks = state.pegs[name];
    disks.forEach(function (size, index) {
      const disk = document.createElement('div');
      disk.className = 'disk d' + size;
      disk.style.setProperty('--size', size);
      disk.textContent = size;
      if (index === disks.length - 1) {
        disk.classList.add('top');
        disk.draggable = true;
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

async function animateTransfer(sourceDisk, sourceRect, targetDisk) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  const targetRect = targetDisk.getBoundingClientRect();
  const ghost = sourceDisk.cloneNode(true);
  ghost.removeAttribute('draggable');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.position = 'fixed';
  ghost.style.left = sourceRect.left + 'px';
  ghost.style.top = sourceRect.top + 'px';
  ghost.style.width = sourceRect.width + 'px';
  ghost.style.height = sourceRect.height + 'px';
  ghost.style.margin = '0';
  ghost.style.zIndex = '1000';
  ghost.style.pointerEvents = 'none';

  const deltaX = targetRect.left - sourceRect.left;
  const deltaY = targetRect.top - sourceRect.top;
  const boardTop = document.getElementById('board').getBoundingClientRect().top;
  const hoverTop = Math.max(12, boardTop - sourceRect.height - 20);
  const liftY = hoverTop - sourceRect.top;
  targetDisk.style.visibility = 'hidden';
  document.body.appendChild(ghost);

  try {
    await ghost.animate([
      { transform: 'translateY(0)' },
      { transform: 'translateY(' + liftY + 'px)' }
    ], {
      duration: 260,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
    }).finished;
    await ghost.animate([
      { transform: 'translate(' + 0 + 'px, ' + liftY + 'px)' },
      { transform: 'translate(' + deltaX + 'px, ' + liftY + 'px)' }
    ], {
      duration: 420,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
    }).finished;
    await ghost.animate([
      { transform: 'translate(' + deltaX + 'px, ' + liftY + 'px)' },
      { transform: 'translate(' + deltaX + 'px, ' + deltaY + 'px)' }
    ], {
      duration: 260,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
    }).finished;
  } finally {
    ghost.remove();
    targetDisk.style.visibility = '';
  }
}

async function performMove(from, to) {
  const sourcePeg = document.querySelector('.peg[data-peg="' + from + '"]');
  const sourceDisk = sourcePeg.querySelector('.disk.top');
  const sourceRect = sourceDisk ? sourceDisk.getBoundingClientRect() : null;

  state = await callApi('POST', '/api/move', { from: from, to: to });
  selected = null;
  draw();

  const targetPeg = document.querySelector('.peg[data-peg="' + to + '"]');
  const targetDisk = targetPeg.querySelector('.disk.top');
  if (sourceDisk && sourceRect && targetDisk) {
    await animateTransfer(sourceDisk, sourceRect, targetDisk);
  }
  showMessage('Moved ' + from + ' to ' + to + '.', false);
}

async function move(from, to) {
  if (busy || animating) { return; }
  animating = true;
  try {
    await performMove(from, to);
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    animating = false;
    draw();
  }
}

function clickPeg(name) {
  if (busy || animating) { return; }
  if (selected === null) {
    selected = name;
    draw();
  } else {
    const from = selected;
    selected = null;
    if (from === name) {
      draw();
    } else {
      move(from, name);
    }
  }
}

async function newGame() {
  if (busy || animating) { return; }
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

async function autoSolve() {
  if (busy || animating) { return; }
  busy = true;
  try {
    await newGame2();
    const plan = await callApi('GET', '/api/solve?disks=' + state.disks);
    for (const step of plan.moves) {
      await new Promise(function (done) { setTimeout(done, 400); });
      await performMove(step.from, step.to);
    }
    showMessage('Auto-solve finished!', false);
  } catch (error) {
    showMessage(error.message, true);
  }
  busy = false;
}

async function newGame2() {
  state = await callApi('POST', '/api/reset', { disks: state.disks });
  draw();
}

for (const name of PEGS) {
  const pegDiv = document.querySelector('.peg[data-peg="' + name + '"]');

  pegDiv.addEventListener('click', function () { clickPeg(name); });

  pegDiv.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      clickPeg(name);
    }
  });

  pegDiv.addEventListener('dragstart', function () {
    if (!busy && !animating) { dragFrom = name; }
  });
  pegDiv.addEventListener('dragover', function (event) {
    event.preventDefault();
  });
  pegDiv.addEventListener('drop', function (event) {
    event.preventDefault();
    if (dragFrom !== null && dragFrom !== name && !busy && !animating) {
      selected = null;
      move(dragFrom, name);
    }
    dragFrom = null;
  });
}

document.getElementById('reset-btn').addEventListener('click', newGame);
document.getElementById('disk-count').addEventListener('change', newGame);
document.getElementById('solve-btn').addEventListener('click', autoSolve);

(async function start() {
  try {
    state = await callApi('GET', '/api/state');
    draw();
    showMessage('Move all disks from peg A to peg C.', false);
  } catch (error) {
    showMessage('Cannot reach the server. Is server.pl running?', true);
  }
})();
