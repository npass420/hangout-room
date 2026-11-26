// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/maker/scene.js <<<<<
// The Scene room: a big Workshop-style white room (maker/room.js), the Game Room's size (18 by 22 m and 7 tall), for
// the holodeck at full scale: its dome reaches 18 m out, a big shallow sky over a wide sheet of water to walk about on.
// For now it's just the room and its holodeck. Reached by its portal on the Doodle Gallery's back wall (?room=scene);
// its own portal on the back wall goes back.
// =====================================================================================================================
import { startRoom } from './room.js';

startRoom({ key: 'scene', title: 'Scene Room', HX: 9, HZ: 11, RH: 7, dome: { radius: 18, wall: 3.2, rise: 8 } });
// >>>>> END OF FILE: HangoutRoom/maker/scene.js <<<<<
