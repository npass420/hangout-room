// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/maker/maker.js <<<<<
// The Maker: a Workshop-style white room (maker/room.js, the Workshop's size: 10 by 10 m and 6 tall) with six
// floating stands in a ring (maker/bench.js), where anyone can take a stand and make things out of simple shapes:
// move, turn, size and stretch them, cut them into each other and join them, give them colors and finishes, and save
// them for everyone. Its holodeck dome reaches well past the walls (11 m out), so there's room to wander the water.
// Reached by its portal on the Doodle Gallery's back wall (?room=maker); its own portal on the back wall goes back.
// =====================================================================================================================
import { startRoom } from './room.js';
import { makeBench } from './bench.js';

startRoom({ key: 'maker', title: 'Maker', HX: 5, HZ: 5, RH: 6, dome: { radius: 11, wall: 2.4, rise: 5 }, bench: makeBench });
// >>>>> END OF FILE: HangoutRoom/maker/maker.js <<<<<
