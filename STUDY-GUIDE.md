# Tower of Hanoi: defense study guide

Read this top to bottom once (about 30 minutes), then do the "practice" parts.
The real work is in `server.pl`. The other files are supporting cast.

---

## 0. How to run it (do this FIRST, tonight, and again before the defense)

1. Install SWI-Prolog (swi-prolog.org, Windows: tick "Add to PATH"). Check: `swipl --version`
2. Open the project folder in VS Code, open the terminal (Ctrl+`).
3. `swipl server.pl`
4. Open http://localhost:8080/

You MUST start it from inside the project folder, because the server finds
`index.html`, `style.css` and `app.js` by their plain file names.
Stop with Ctrl+C. After changing `server.pl`, stop and start again.

---

## 1. The whole project in 30 seconds (say this first)

> "It is a Tower of Hanoi game. The **frontend** (HTML, CSS, JavaScript) draws
> the pegs and disks and takes the player's clicks. The **backend** is written
> in **SWI-Prolog**: it knows the rules, checks every move, counts moves, and
> solves the puzzle recursively. The two talk through a small **REST API**
> that sends **JSON**. The browser never decides if a move is legal; Prolog does."

```
 Browser (app.js)  --- POST /api/move {"from":"A","to":"C"} --->  Prolog (server.pl)
                   <--- JSON: the new game state (or an error) ---
```

Files:

| File | What it is | Size |
|---|---|---|
| `server.pl` | Prolog: rules, solver, API, security checks | 214 lines (about half are comments) |
| `app.js` | JavaScript: draws the game, sends moves | 197 lines |
| `index.html` | the page structure (3 pegs, buttons) | 80 lines |
| `style.css` | colors and layout | 200 lines |

If you only have time to understand one file deeply, make it `server.pl`.

---

## 2. server.pl, section by section

### 2.1 Game state = Prolog facts that change

```prolog
:- dynamic peg/2, disks/1, moves/1.
```
`dynamic` means "these facts can be added and removed while the program runs."

```prolog
peg('A', [1,2,3]).   % peg A holds disks 1, 2, 3. The FIRST item is the TOP disk.
peg('B', []).
peg('C', []).
disks(3).            % number of disks
moves(0).            % moves made so far
```
Disk 1 is the smallest. So `[1,2,3]` means the small disk is on top. Good.

`new_game(N)` deletes all old facts (`retractall`) and adds fresh ones (`assertz`).
`numlist(1, N, List)` builds `[1,2,...,N]`.

### 2.2 The rules

```prolog
legal_move(From, To) :-
    From \== To,                  % not the same peg
    peg(From, [Disk|_]),          % From has a top disk (fails if empty)
    (   peg(To, [])               % To is empty, OR
    ;   peg(To, [Top|_]),         % the top of To is
        Disk < Top                % bigger than the disk I am moving
    ).
```
`[Disk|_]` means "a list whose first item is Disk and the rest doesn't matter".
If the peg is empty `[]`, this pattern doesn't match, so the rule fails. That
is how "can't move from an empty peg" works without extra code.
`;` means OR.

```prolog
do_move(From, To) :-
    retract(peg(From, [Disk|Rest])),  % remove the old fact for From
    assertz(peg(From, Rest)),         % add it back without the top disk
    retract(peg(To, Old)),
    assertz(peg(To, [Disk|Old])),     % put the disk on top of To
    retract(moves(M)), M1 is M + 1, assertz(moves(M1)).   % counter + 1
```

```prolog
solved :- disks(N), peg('C', List), length(List, N).
```
Solved = peg C has all N disks.

### 2.3 The solver (the part your teacher will care about most)

```prolog
hanoi(0, _, _, _, []).                    % base case: 0 disks = no moves
hanoi(N, From, To, Via, Moves) :-
    N > 0,
    N1 is N - 1,
    hanoi(N1, From, Via, To, Moves1),     % step 1
    hanoi(N1, Via, To, From, Moves2),     % step 3
    append(Moves1, [move(From, To)], Temp),
    append(Temp, Moves2, Moves).          % Moves = Moves1 + middle move + Moves2
```

**The idea (memorize this sentence):** to move N disks from `From` to `To`:
1. move the top N-1 disks out of the way, onto the spare peg `Via`,
2. move the biggest disk from `From` to `To`,
3. move those N-1 disks from `Via` onto `To`.

Moving N-1 disks is the same problem, only smaller. That is the **recursion**.
`hanoi(0, ...)` is the **base case** that stops it.

**Trace for 2 disks** (`hanoi(2, 'A', 'C', 'B', M)`). Be able to do this on paper:

```
hanoi(2, A, C, B):
   step 1: hanoi(1, A, B, C)  ->  hanoi(0..) + move(A,B) + hanoi(0..)  = [A->B]
   middle:                         move(A,C)
   step 3: hanoi(1, B, C, A)  ->                move(B,C)             = [B->C]
   Moves = [A->B, A->C, B->C]
```
Check by hand: small disk to B, big disk to C, small disk onto C. Correct.

**How many moves?** 1 disk = 1, 2 disks = 3, 3 disks = 7, 4 disks = 15.
Formula: **2^N - 1**. That is the minimum, and the game shows it as "Minimum
possible". For 8 disks: 255 moves.
Why: `T(N) = T(N-1) + 1 + T(N-1) = 2*T(N-1) + 1`. This is exactly the three steps above.

### 2.4 Input checks

```prolog
valid_peg(P)   :- memberchk(P, ['A','B','C']).
valid_disks(N) :- integer(N), N >= 3, N =< 8.
```
The server never trusts the browser. Anyone can send any request with curl,
not only the web page. So the server checks that the peg is A, B or C and that
the disk count is a whole number from 3 to 8.

### 2.5 Routes

```prolog
:- http_handler(root(api/move), handle_move, [method(post)]).
```
Read it as: "when a **POST** request arrives at `/api/move`, call `handle_move`."

| URL | Method | Does |
|---|---|---|
| `/api/solve?disks=N` | GET | returns the list of moves that solves N disks |
| `/api/state` | GET | returns the current game |
| `/api/move` | POST | tries one move: `{"from":"A","to":"C"}` |
| `/api/reset` | POST | new game: `{"disks":4}` |
| `/`, `/style.css`, `/app.js` | GET | the web page files |

If the method is wrong (GET on /api/move) the library answers **405**.
Unknown path: **404**.

### 2.6 Handlers and status codes

`handle_move` reads the JSON body, checks `from`/`to` with `valid_peg`, then
calls `try_move`, which uses `legal_move` and `do_move`.

| Code | Meaning | When |
|---|---|---|
| 200 | OK | move accepted, state returned |
| 400 | Bad request | missing/invalid peg or disks, broken JSON |
| 405 | Method not allowed | GET on a POST-only URL |
| 404 | Not found | unknown URL |
| 409 | Conflict | valid request, but the move breaks the rules |

`with_mutex(hanoi, ...)` means "only one request at a time may change the game."
Without it, two requests at the same moment could corrupt the facts.

`send_state` builds the answer. Example:
```json
{"disks":3,"moves":1,"minMoves":7,"pegs":{"A":[3,2],"B":[],"C":[1]},"solved":false}
```
Here each peg is listed **bottom disk first** (so the browser draws in order).
Inside Prolog it is top-first, so `reverse/2` flips it.

---

## 3. app.js in plain words

- `callApi(method, url, body)`: sends a request with `fetch`, returns the JSON. If the server answered with an error code, it throws the server's message.
- `draw()`: wipes the pegs and rebuilds the disks from `state`. A disk's width comes from its size.
- `move(from, to)`: calls `/api/move`, saves the new `state`, calls `draw()`. If Prolog says illegal, the error text is shown under the buttons.
- `clickPeg(name)`: first click remembers the peg (`selected`), second click makes the move.
- Drag and drop and Enter/Space on a peg both end up calling `move()` too.
- `autoSolve()`: resets, asks `/api/solve`, then plays each returned move every 400 ms through `/api/move`.

Key point to say: **the JavaScript has no rules in it.** Every move goes to Prolog.

---

## 4. The security requirements, and where each one is

| Requirement | Where |
|---|---|
| Validate input (disks 3-8, pegs A/B/C) | `valid_peg`, `valid_disks` in `server.pl` |
| Reject bad JSON, proper 400/404/405 | `read_body` (catches bad JSON), `[method(post)]` on routes, `send_error` |
| Security headers | `security_headers` and `send` in `server.pl` |
| No XSS (don't build HTML from user input) | `app.js` uses `textContent` and `createElement`, never `innerHTML` |
| Limit size / recursion | disks must be at most 8, so the solver never makes more than 255 moves |

What the headers do:
- **Content-Security-Policy: default-src 'self'**: the browser only loads scripts, styles and requests from our own server. Blocks injected outside scripts.
- **X-Content-Type-Options: nosniff**: the browser must trust the declared file type and not guess.
- **X-Frame-Options: DENY**: other sites can't put our page in an iframe (clickjacking).

What is **XSS**? Attacker text containing `<script>` gets inserted as HTML and
runs. `textContent` treats text as plain text, so it can't run.

---

## 5. Likely questions, with answers

**Why Prolog for the backend?**
Rules like "a larger disk may not go on a smaller one" and the recursive solution
are very natural in Prolog: facts plus rules, and recursion, with no loops.

**Explain recursion in your solver.**
Use the three-step sentence in 2.3 and the 2-disk trace.

**What is the base case?**
`hanoi(0, _, _, _, [])`: zero disks need zero moves. Without it the recursion never stops.

**Why is the minimum 2^N - 1?**
`T(N) = 2*T(N-1) + 1`, because we solve N-1 disks twice and move the big disk once.

**What does `retract` / `assertz` do?**
`retract` removes a fact from the database; `assertz` adds one at the end. That is how
the game state changes.

**What does `dynamic` mean?**
It declares that facts of that name can be changed at runtime.

**Where are the game rules checked, browser or server?**
Server (Prolog). The browser only shows the result. That way nobody can cheat by editing JavaScript.

**What is REST / JSON?**
REST: using URLs and HTTP methods (GET to read, POST to change) as an API. JSON: a text
format for data, e.g. `{"from":"A","to":"C"}`.

**Why return 409 for an illegal move and 400 for a bad one?**
400 = the request itself is malformed (bad peg letter, broken JSON). 409 = the request is
fine, but conflicts with the current game state (breaking a rule).

**How do you stop bad input?**
The server checks everything again even though the browser also limits it. Browsers can be bypassed.

**Limitations / what would you improve?** (be honest, it scores well)
- There is **one game for everybody** (global facts). Two people playing at the same time would share a board. A real version stores a game **per user session** (cookie), which my other version of this project does.
- No undo, no timer, no best-score storage.
- Dragging doesn't work on phone touch screens (tap to move works).

---

## 6. One-night study plan

1. **(30 min)** Run it. Play it. Click around. Use auto-solve. Break the rules on purpose to see the error.
2. **(30 min)** Read section 2.3 again and write `hanoi/5` **by hand on paper** for 2 disks, then 3 disks. This is the most important hour of the night, because the solver is what you will be asked about.
3. **(30 min)** Open `server.pl` in VS Code and read it top to bottom, matching it to this guide.
4. **(20 min)** Test the solver directly in Prolog, without the web page. In the terminal:
   ```
   swipl -l server.pl
   ```
   (`-l` loads the file but does NOT start the web server.) At the `?-` prompt type, with the final dot:
   ```
   ?- hanoi(2, 'A', 'C', 'B', Moves).
   ```
   It prints `Moves = [move('A','B'), move('A','C'), move('B','C')]`. Try 3 and 4 disks.
   Then watch the recursion happen step by step:
   ```
   ?- trace, hanoi(2, 'A', 'C', 'B', Moves).
   ```
   Press Enter repeatedly to step through. Use `notrace.` to stop and `halt.` to quit.
   Also try the rules: `?- legal_move('A', 'C').` (true at the start) and `?- legal_move('B', 'C').` (false, B is empty).
   If Prolog prints `true` and then waits, just press Enter.
5. **(20 min)** Test the API by hand with curl (or the browser address bar for GET):
   `http://localhost:8080/api/solve?disks=3` and `http://localhost:8080/api/state`
6. **(20 min)** Say the answers in section 5 out loud, without reading.
7. **Sleep.** A rested head beats a fourth hour of reading.

Before the defense: start the server, load the page once, and keep the terminal open.
If anything breaks live, refresh the page and `Ctrl+C`, `swipl server.pl` again.
