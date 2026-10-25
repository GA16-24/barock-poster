import * as THREE from 'three';
import { wallPose } from './pose.js';

// Tilt is measured against the line of sight, so turning the phone leaves it alone and only walking around the
// thermostat changes it. That allows heavy smoothing without the lag it would have in camera space.
const TILT_SMOOTHING = 0.15;
// At 2 m the perspective cue favours the right one of the two mirrored tilts only by a small margin, so the tracker
// sums its votes. The sum is capped at VOTE_CAP and the tilt flips once it falls below -FLIP_AT, so going from sure
// to flipped takes a net 12 frames of full votes against.
const VOTE_CAP = 8;
const FLIP_AT = 4;
// Within a few degrees of facing the LCD both tilts look the same, so those frames barely vote.
const CUE_FULL_TILT = Math.sin(THREE.MathUtils.degToRad(15));

const frame = new THREE.Matrix4(), m = new THREE.Matrix4();
const candidates = [new THREE.Quaternion(), new THREE.Quaternion()];
const normals = [new THREE.Vector3(), new THREE.Vector3()];
const correction = new THREE.Quaternion(), frameQuat = new THREE.Quaternion();
const vec = (a) => new THREE.Vector3(...a);

export function createWallTracker() {
  // The smoothed LCD normal in the line-of-sight frame, and the summed votes of the perspective cue for the tilt the
  // tracker picked (positive agrees, negative wants the mirror).
  let normal = null, vote = 0;
  return {
    flips: 0,
    reset() {
      normal = null;
      vote = 0;
    },
    // Writes the LCD pose in camera space; false when the quad is degenerate.
    update(quad, f, cx, cy, position, quaternion) {
      const w = wallPose(quad, f, cx, cy);
      if (!w) return false;
      w.rotations.forEach((r, i) => {
        candidates[i].setFromRotationMatrix(m.makeBasis(vec(r[0]), vec(r[1]), vec(r[2])));
        normals[i].set(...r[2]);
      });
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
      // Keep the measured roll and swap only the tilt for the smoothed one.
      correction.setFromUnitVectors(normals[pick], normal);
      frameQuat.setFromRotationMatrix(frame.makeBasis(vec(w.frame[0]), vec(w.frame[1]), vec(w.frame[2])));
      quaternion.copy(frameQuat).multiply(correction).multiply(candidates[pick]);
      position.set(...w.ray).multiplyScalar(w.distance);
      return true;
    },
  };
}
