import * as THREE from 'three';
import { wallPose } from './pose.js';

// Tilt is measured against the line of sight, so turning the phone leaves it alone and only walking around the
// thermostat changes it. That allows heavy smoothing without the lag it would have in camera space.
const TILT_SMOOTHING = 0.1;
// The scene reaches 1.1 m past the 6 cm LCD, so the noise in each frame's distance and roll moves its ends 20 times
// as far as the LCD's own corners, about 9 px per frame on a phone video (test/shake.mjs). Both barely change while
// the user stands in front of the wall, so they go through one-euro filters: heavy smoothing while they hold still,
// little lag once they change fast. The ray to the LCD center is exact to a pixel and stays unfiltered.
const DISTANCE_FILTER = { minCutoff: 0.2, beta: 0.5 };
const ROLL_FILTER = { minCutoff: 0.2, beta: 0.3 };
// At 2 m the perspective cue favours the right one of the two mirrored tilts only by a small margin, so the tracker
// sums its votes. The sum is capped at VOTE_CAP and the tilt flips once it falls below -FLIP_AT, so going from sure
// to flipped takes a net 12 frames of full votes against.
const VOTE_CAP = 8;
const FLIP_AT = 4;
// Within a few degrees of facing the LCD both tilts look the same, so those frames barely vote.
const CUE_FULL_TILT = Math.sin(THREE.MathUtils.degToRad(15));

const frame = new THREE.Matrix4(), m = new THREE.Matrix4();
const normals = [new THREE.Vector3(), new THREE.Vector3()];
const lcdQuat = new THREE.Quaternion(), rollTurn = new THREE.Quaternion();
const ray = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
const vec = (a) => new THREE.Vector3(...a);

// Casiez et al., "1€ Filter" (CHI 2012). Cutoffs in Hz, t in seconds.
function oneEuro({ minCutoff, beta, dCutoff = 1 }) {
  const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
  let x = null, dx = 0, last = 0;
  return {
    reset() {
      x = null;
    },
    filter(value, t) {
      if (x === null || t <= last) {
        if (x === null) [x, dx] = [value, 0];
        last = t;
        return x;
      }
      const dt = t - last;
      last = t;
      dx += alpha(dCutoff, dt) * ((value - x) / dt - dx);
      x += alpha(minCutoff + beta * Math.abs(dx), dt) * (value - x);
      return x;
    },
  };
}

export function createWallTracker() {
  // The smoothed LCD normal in the line-of-sight frame, and the summed votes of the perspective cue for the tilt the
  // tracker picked (positive agrees, negative wants the mirror).
  let normal = null, vote = 0;
  const distance = oneEuro(DISTANCE_FILTER), roll = oneEuro(ROLL_FILTER);
  let lastRoll = 0;
  return {
    flips: 0,
    reset() {
      normal = null;
      vote = 0;
      distance.reset();
      roll.reset();
    },
    // Writes the LCD pose in camera space; false when the quad is degenerate.
    update(quad, f, cx, cy, t, position, quaternion) {
      const w = wallPose(quad, f, cx, cy);
      if (!w) return false;
      w.rotations.forEach((r, i) => normals[i].set(...r[2]));
      let pick;
      if (!normal) {
        pick = w.cue >= 0 ? 0 : 1;
        normal = normals[pick].clone();
      } else {
        pick = normals[0].dot(normal) >= normals[1].dot(normal) ? 0 : 1;
        const weight = Math.min(1, Math.hypot(normals[pick].x, normals[pick].y) / CUE_FULL_TILT);
        vote = Math.min(VOTE_CAP, vote + (pick === 0 ? w.cue : -w.cue) * weight);
        if (vote < -FLIP_AT) {
          pick = 1 - pick;
          normal.set(-normal.x, -normal.y, normal.z);
          vote = -vote;
          this.flips++;
        }
        normal.lerp(normals[pick], TILT_SMOOTHING).normalize();
      }
      // The LCD is built from the smoothed normal alone, its x axis level in the frame. The measured rotations also
      // carry a twist about the normal, but that is the same roll measured worse.
      side.crossVectors(Y, normal).normalize();
      lcdQuat.setFromRotationMatrix(m.makeBasis(side, up.crossVectors(normal, side), normal));
      quaternion.setFromRotationMatrix(frame.makeBasis(vec(w.frame[0]), vec(w.frame[1]), vec(w.frame[2]))).multiply(lcdQuat);
      ray.set(...w.ray);
      // Roll is unwrapped against the last frame, so a turn through ±180° does not swing the filter the long way round.
      lastRoll += Math.atan2(Math.sin(w.roll - lastRoll), Math.cos(w.roll - lastRoll));
      quaternion.premultiply(rollTurn.setFromAxisAngle(ray, roll.filter(lastRoll, t) - lastRoll));
      position.copy(ray).multiplyScalar(distance.filter(w.distance, t));
      return true;
    },
  };
}
