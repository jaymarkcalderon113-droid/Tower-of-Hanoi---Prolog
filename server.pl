:- use_module(library(http/thread_httpd)).
:- use_module(library(http/http_dispatch)).
:- use_module(library(http/http_json)).

:- dynamic peg/2, disks/1, moves/1.

new_game(N) :-
    retractall(peg(_, _)),
    retractall(disks(_)),
    retractall(moves(_)),
    numlist(1, N, List),
    assertz(peg('A', List)),
    assertz(peg('B', [])),
    assertz(peg('C', [])),
    assertz(disks(N)),
    assertz(moves(0)).

:- new_game(3).

legal_move(From, To) :-
    From \== To,
    peg(From, [Disk|_]),
    (   peg(To, [])
    ;   peg(To, [Top|_]),
        Disk < Top
    ).

do_move(From, To) :-
    retract(peg(From, [Disk|Rest])),
    assertz(peg(From, Rest)),
    retract(peg(To, Old)),
    assertz(peg(To, [Disk|Old])),
    retract(moves(M)),
    M1 is M + 1,
    assertz(moves(M1)).

solved :-
    disks(N),
    peg('C', List),
    length(List, N).

hanoi(0, _, _, _, []).
hanoi(N, From, To, Via, Moves) :-
    N > 0,
    N1 is N - 1,
    hanoi(N1, From, Via, To, Moves1),
    hanoi(N1, Via, To, From, Moves2),
    append(Moves1, [move(From, To)], Temp),
    append(Temp, Moves2, Moves).

valid_peg(P)   :- memberchk(P, ['A', 'B', 'C']).
valid_disks(N) :- integer(N), N >= 3, N =< 8.

:- http_handler(root(api/solve), handle_solve, [method(get)]).
:- http_handler(root(api/state), handle_state, [method(get)]).
:- http_handler(root(api/move),  handle_move,  [method(post)]).
:- http_handler(root(api/reset), handle_reset, [method(post)]).
:- http_handler(root(.),         serve_index,  []).
:- http_handler(root('style.css'), serve_css,  []).
:- http_handler(root('app.js'),    serve_js,   []).

serve_index(Request) :- serve('index.html', 'text/html', Request).
serve_css(Request)   :- serve('style.css',  'text/css',  Request).
serve_js(Request)    :- serve('app.js', 'text/javascript', Request).

serve(File, Mime, Request) :-
    security_headers(Headers),
    http_reply_file(File, [mime_type(Mime), headers(Headers)], Request).

security_headers([ content_security_policy("default-src 'self'; img-src 'self' data:"),
                   x_content_type_options("nosniff"),
                   x_frame_options("DENY") ]).

send(Dict, Status) :-
    format('X-Content-Type-Options: nosniff~n'),
    format('X-Frame-Options: DENY~n'),
    format("Content-Security-Policy: default-src 'self'; img-src 'self' data:~n"),
    reply_json_dict(Dict, [status(Status)]).

send_error(Status, Message) :-
    send(_{error: Message}, Status).

handle_solve(Request) :-
    read_disks(Request, N),
    !,
    hanoi(N, 'A', 'C', 'B', Moves),
    maplist(move_to_dict, Moves, MoveDicts),
    send(_{disks: N, moves: MoveDicts}, 200).
handle_solve(_) :-
    send_error(400, 'disks must be an integer from 3 to 8').

read_disks(Request, N) :-
    memberchk(search(Search), Request),
    memberchk(disks=Text, Search),
    atom_number(Text, N),
    valid_disks(N).

move_to_dict(move(F, T), _{from: F, to: T}).

handle_state(_) :-
    send_state.

handle_reset(Request) :-
    read_body(Request, Body),
    (   get_dict(disks, Body, N), valid_disks(N)
    ->  with_mutex(hanoi, new_game(N)),
        send_state
    ;   send_error(400, 'disks must be an integer from 3 to 8')
    ).

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

try_move(From, To, Result) :-
    (   \+ solved, legal_move(From, To)
    ->  do_move(From, To),
        Result = ok
    ;   Result = illegal
    ).

read_body(Request, Body) :-
    catch(http_read_json_dict(Request, Body, [value_string_as(atom)]),
          _, Body = _{}).

send_state :-
    disks(N),
    moves(M),
    MinMoves is 2**N - 1,
    findall(Name-Bottom,
            ( member(Name, ['A', 'B', 'C']),
              peg(Name, Top),
              reverse(Top, Bottom) ),
            Pairs),
    dict_pairs(Pegs, pegs, Pairs),
    (   solved -> Solved = true ; Solved = false ),
    send(_{disks: N, moves: M, minMoves: MinMoves,
           pegs: Pegs, solved: Solved}, 200).

start :-
    http_server(http_dispatch, [port(localhost:8080)]),
    format('Tower of Hanoi running at http://localhost:8080/~n'),
    thread_get_message(_).

:- initialization(start, main).
