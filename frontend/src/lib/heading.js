const DEG = Math.PI / 180;

// Compass heading (0 = north, clockwise) of the direction the rear camera faces,
// or null when this event can't yield a usable one.
export function headingFromEvent(e) {
  // iOS: already tilt-compensated by CoreLocation.
  if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) {
    return e.webkitCompassHeading;
  }
  // Non-absolute orientation is drifting gyro with no north reference — useless here.
  if (e.absolute !== true || e.alpha == null || e.beta == null || e.gamma == null) return null;
  return headingFromEuler(e.alpha, e.beta, e.gamma);
}

// alpha/beta/gamma describe the device body frame, so the camera axis (-z) is
// independent of screen rotation — no screen.orientation.angle correction needed.
export function headingFromEuler(alpha, beta, gamma) {
  const z = alpha * DEG, x = beta * DEG, y = gamma * DEG;
  const cX = Math.cos(x), cY = Math.cos(y), cZ = Math.cos(z);
  const sX = Math.sin(x), sY = Math.sin(y), sZ = Math.sin(z);

  // W3C intrinsic Z-X'-Y'' matrix, device -> world (x East, y North, z Up).
  const m13 = cY * sZ * sX + cZ * sY;
  const m23 = sZ * sY - cZ * cY * sX;
  const m33 = cX * cY;

  // Camera direction is the device's -z axis expressed in world coords.
  const east = -m13, north = -m23, up = -m33;

  // Pointing near straight up/down leaves no horizontal component to read.
  if (Math.hypot(east, north) < 0.15 || Math.abs(up) > 0.985) return null;

  return (Math.atan2(east, north) / DEG + 360) % 360;
}

// Smooths on the unit vector, not the scalar — averaging 359 and 1 as numbers
// gives 180, which would swing the heading to the opposite side.
export function createHeadingSmoother(alpha = 0.15) {
  let vx = null, vy = null;
  return {
    push(deg) {
      const r = deg * DEG;
      const cx = Math.cos(r), cy = Math.sin(r);
      if (vx === null) { vx = cx; vy = cy; }
      else { vx += (cx - vx) * alpha; vy += (cy - vy) * alpha; }
      return (Math.atan2(vy, vx) / DEG + 360) % 360;
    },
    reset() { vx = null; vy = null; },
  };
}

// Shortest angular distance between two bearings, 0..180.
export function angleDelta(a, b) {
  const d = Math.abs((a - b) % 360);
  return d > 180 ? 360 - d : d;
}
