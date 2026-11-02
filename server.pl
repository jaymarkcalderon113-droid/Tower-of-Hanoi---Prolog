% =====================================================================
%  server.pl  --  Tower of Hanoi backend (SWI-Prolog)
%
%  Run:   swipl server.pl        Open: http://localhost:8080/
%
%  API:   GET  /api/solve?disks=N   -> list of moves that solves N disks
%         POST /api/move            {"from":"A","to":"C"}
%         POST /api/reset           {"disks":N}
%         GET  /api/state           -> the current game
% =====================================================================

:- use_module(library(http/thread_httpd)).
:- use_module(library(http/http_dispatch)).
:- use_module(library(http/http_json)).

% ---------------------------------------------------------------------
%  GAME STATE  (facts that we change while the game runs)
%    peg('A', [1,2,3])  = peg A holds disks 1,2,3 (TOP disk first)
%    disks(N)           = how many disks this game has
%    moves(M)           = how many moves the player has made
% ---------------------------------------------------------------------
:- dynamic peg/2, disks/1, moves/1.

% new_game(+N): put N disks on peg A, empty B and C, move count 0.
new_game(N) :-
    retractall(peg(_, _)),
    retractall(disks(_)),
    retractall(moves(_)),
    numlist(1, N, List),            % List = [1,2,...,N]
    assertz(peg('A', List)),
    assertz(peg('B', [])),
    assertz(peg('C', [])),
    assertz(disks(N)),
    assertz(moves(0)).

% The game starts with 3 disks when the server starts.
:- new_game(3).

% ---------------------------------------------------------------------
%  GAME RULES
% ---------------------------------------------------------------------

% legal_move(+From, +To): true if the top disk of From may go onto To.
legal_move(From, To) :-
    From \== To,                    % must be two different pegs
    peg(From, [Disk|_]),            % From must have a top disk
    (   peg(To, [])                 % To is empty ... OR
    ;   peg(To, [Top|_]),           % ... the top disk of To is
        Disk < Top                  %     LARGER than the moving disk
    ).

% do_move(+From, +To): actually move the disk and add 1 to the counter.
do_move(From, To) :-
    retract(peg(From, [Disk|Rest])),
    assertz(peg(From, Rest)),
    retract(peg(To, Old)),
    assertz(peg(To, [Disk|Old])),
    retract(moves(M)),
    M1 is M + 1,
    assertz(moves(M1)).

% solved: true when every disk is on peg C.
solved :-
    disks(N),
    peg('C', List),
    length(List, N).

% ---------------------------------------------------------------------
%  SOLVER  (the classic recursive solution)
%  hanoi(+N, +From, +To, +Via, -Moves)
%    To move N disks from From to To (using Via as the spare peg):
%      1. move the top N-1 disks From -> Via   (To is the spare)
%      2. move the biggest disk   From -> To
%      3. move the N-1 disks      Via  -> To   (From is the spare)
% ---------------------------------------------------------------------
hanoi(0, _, _, _, []).              % base case: nothing to move
hanoi(N, From, To, Via, Moves) :-
    N > 0,
    N1 is N - 1,
    hanoi(N1, From, Via, To, Moves1),
    hanoi(N1, Via, To, From, Moves2),
    append(Moves1, [move(From, To)], Temp),
    append(Temp, Moves2, Moves).

% ---------------------------------------------------------------------
%  INPUT CHECKS  (never trust what the browser sends)
% ---------------------------------------------------------------------
valid_peg(P)   :- memberchk(P, ['A', 'B', 'C']).
valid_disks(N) :- integer(N), N >= 3, N =< 8.

% ---------------------------------------------------------------------
%  ROUTES   (URL -> predicate that handles it)
% ---------------------------------------------------------------------
:- http_handler(root(api/solve), handle_solve, [method(get)]).
:- http_handler(root(api/state), handle_state, [method(get)]).
:- http_handler(root(api/move),  handle_move,  [method(post)]).
:- http_handler(root(api/reset), handle_reset, [method(post)]).
:- http_handler(root(.),         serve_index,  []).
:- http_handler(root('style.css'), serve_css,  []).
:- http_handler(root('app.js'),    serve_js,   []).

% Static files (must be run from inside this folder).
serve_index(Request) :- serve('index.html', 'text/html', Request).
serve_css(Request)   :- serve('style.css',  'text/css',  Request).
serve_js(Request)    :- serve('app.js', 'text/javascript', Request).

serve(File, Mime, Request) :-
    security_headers(Headers),
    http_reply_file(File, [mime_type(Mime), headers(Headers)], Request).

% Headers that protect the browser (see the study guide).
security_headers([ content_security_policy("default-src 'self'; img-src 'self' data:"),
                   x_content_type_options("nosniff"),
                   x_frame_options("DENY") ]).

% send(+Dict, +Status): send JSON with the security headers.
send(Dict, Status) :-
    format('X-Content-Type-Options: nosniff~n'),
    format('X-Frame-Options: DENY~n'),
    format("Content-Security-Policy: default-src 'self'; img-src 'self' data:~n"),
    reply_json_dict(Dict, [status(Status)]).

% send_error(+Status, +Message): send an error reply.
send_error(Status, Message) :-
    send(_{error: Message}, Status).

% ---------------------------------------------------------------------
%  HANDLERS
% ---------------------------------------------------------------------

% GET /api/solve?disks=N
handle_solve(Request) :-
    read_disks(Request, N),
    !,
    hanoi(N, 'A', 'C', 'B', Moves),
    maplist(move_to_dict, Moves, MoveDicts),
    send(_{disks: N, moves: MoveDicts}, 200).
handle_solve(_) :-
    send_error(400, 'disks must be an integer from 3 to 8').

% read ?disks=N from the URL and check it
read_disks(Request, N) :-
    memberchk(search(Search), Request),
    memberchk(disks=Text, Search),
    atom_number(Text, N),
    valid_disks(N).

move_to_dict(move(F, T), _{from: F, to: T}).

% GET /api/state
handle_state(_) :-
    send_state.

% POST /api/reset   {"disks": N}
handle_reset(Request) :-
    read_body(Request, Body),
    (   get_dict(disks, Body, N), valid_disks(N)
    ->  with_mutex(hanoi, new_game(N)),
        send_state
    ;   send_error(400, 'disks must be an integer from 3 to 8')
    ).

% POST /api/move   {"from":"A","to":"C"}
handle_move(Request) :-
    read_body(Request, Body),
    (   get_dict(from, Body, From), valid_peg(From),
        get_dict(to,   Body, To),   valid_peg(To)
    ->  with_mutex(hanoi, try_move(From, To, Result)),
        (   Result == ok
        ->  send_state
        ;   send_error(409, 'illegal move: a larger disk cannot go on a smaller one (and you cannot move from an empty peg or onto the same peg)')
        )
    ;   send_error(400, 'from and to must each be "A", "B" or "C"')
    ).

% try_move(+From, +To, -Result): Result is ok or illegal.
try_move(From, To, Result) :-
    (   \+ solved, legal_move(From, To)
    ->  do_move(From, To),
        Result = ok
    ;   Result = illegal
    ).

% read the JSON body. Text values become atoms ("A" -> 'A') so they can
% be compared with our peg names. Broken JSON gives an empty dict, which
% fails the checks in the handlers and so produces a 400 reply.
read_body(Request, Body) :-
    catch(http_read_json_dict(Request, Body, [value_string_as(atom)]),
          _, Body = _{}).

% send_state: reply with the whole game as JSON.
send_state :-
    disks(N),
    moves(M),
    MinMoves is 2**N - 1,
    findall(Name-Bottom,
            ( member(Name, ['A', 'B', 'C']),
              peg(Name, Top),
              reverse(Top, Bottom) ),     % browser wants bottom disk first
            Pairs),
    dict_pairs(Pegs, pegs, Pairs),
    (   solved -> Solved = true ; Solved = false ),
    send(_{disks: N, moves: M, minMoves: MinMoves,
           pegs: Pegs, solved: Solved}, 200).

% ---------------------------------------------------------------------
%  START THE SERVER
% ---------------------------------------------------------------------
start :-
    http_server(http_dispatch, [port(localhost:8080)]),
    format('Tower of Hanoi running at http://localhost:8080/~n'),
    thread_get_message(_).              % keep the program alive

:- initialization(start, main).
