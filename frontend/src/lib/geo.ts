// Small, dependency-free geodesy helpers used by the risk map. Coordinates are [lat, lon] in degrees.
export type LatLon = [number, number]

const R = 6371 // mean Earth radius, km
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Points along the great circle from a to b (inclusive). Used for air routes and as a fallback path. */
export function greatCircle(a: LatLon, b: LatLon, steps = 64): LatLon[] {
  const [φ1, λ1, φ2, λ2] = [rad(a[0]), rad(a[1]), rad(b[0]), rad(b[1])]
  const d = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2))
  if (d === 0) return [a, b]
  const out: LatLon[] = []
  for (let i = 0; i <= steps; i++) {
    const f = i / steps
    const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d)
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2)
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2)
    const z = A * Math.sin(φ1) + B * Math.sin(φ2)
    out.push([deg(Math.atan2(z, Math.sqrt(x * x + y * y))), deg(Math.atan2(y, x))])
  }
  return out
}

export function pathLengthKm(path: LatLon[]): number {
  let km = 0
  for (let i = 1; i < path.length; i++) km += haversineKm(path[i - 1], path[i])
  return km
}

/** Evenly spaced points (by distance) along a path, endpoints included. */
export function samplePath(path: LatLon[], n: number): LatLon[] {
  if (path.length < 2 || n < 2) return path.slice(0, Math.max(1, n))
  const total = pathLengthKm(path), out: LatLon[] = [path[0]]
  let seg = 1, acc = 0
  for (let k = 1; k < n - 1; k++) {
    const target = (total * k) / (n - 1)
    while (seg < path.length && acc + haversineKm(path[seg - 1], path[seg]) < target) { acc += haversineKm(path[seg - 1], path[seg]); seg++ }
    if (seg >= path.length) break
    const segLen = haversineKm(path[seg - 1], path[seg]) || 1, f = (target - acc) / segLen
    const [a, b] = [path[seg - 1], path[seg]]
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f])
  }
  out.push(path[path.length - 1])
  return out
}

/** Approximate shortest distance (km) from a point to a path, by checking densified path points. */
export function distanceToPathKm(p: LatLon, path: LatLon[]): number {
  const dense = path.length > 300 ? path : samplePath(path, Math.min(300, Math.max(20, Math.round(pathLengthKm(path) / 25))))
  let best = Infinity
  for (const q of dense) best = Math.min(best, haversineKm(p, q))
  return best
}
