import { PerspectiveCamera, Quaternion, Spherical, Vector3 } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Uses the viewport's own camera and target; each pane owns one independent control.
export function createViewGizmo(
  camera: PerspectiveCamera,
  orbit: OrbitControls,
  host: HTMLElement,
) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('view-axis-gizmo');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-label', 'Rotate camera');
  const axes = [
    { name: 'X', color: '#ed526b', v: new Vector3(1, 0, 0) },
    { name: 'Y', color: '#8cbf39', v: new Vector3(0, 1, 0) },
    { name: 'Z', color: '#438eea', v: new Vector3(0, 0, 1) },
  ];
  const inverse = new Quaternion();
  const lines = axes.map((axis) => {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', '50');
    line.setAttribute('y1', '50');
    line.setAttribute('stroke', axis.color);
    line.setAttribute('stroke-width', '2');
    svg.append(line);
    return line;
  });
  const points = axes.flatMap((axis, i) =>
    [1, -1].map((sign) => {
      const group = document.createElementNS(ns, 'g');
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('r', '8');
      circle.setAttribute('stroke', axis.color);
      circle.setAttribute('fill', sign > 0 ? axis.color : '#25252a');
      group.append(circle);
      const label = document.createElementNS(ns, 'text');
      label.textContent = sign > 0 ? axis.name : '';
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dy', '.35em');
      group.append(label);
      group.setAttribute('role', 'button');
      group.setAttribute('tabindex', '0');
      group.setAttribute('aria-label', `${sign > 0 ? '+' : '-'}${axis.name} view`);
      const title = document.createElementNS(ns, 'title');
      title.textContent = `${sign > 0 ? '+' : '-'}${axis.name}`;
      group.append(title);
      const select = () => {
        const radius = camera.position.distanceTo(orbit.target);
        const direction = camera.position.clone().sub(orbit.target).normalize();
        const facing = direction.dot(axis.v) * sign;
        // Clicking the centered axis again flips to its opposite side, like Blender.
        const targetSign = facing > 0.9999 ? -sign : sign;
        // A tiny offset at the poles avoids an ambiguous up vector in OrbitControls.
        camera.position.copy(orbit.target).addScaledVector(axis.v, targetSign * radius);
        if (i === 1) camera.position.z += 0.0001;
        orbit.update();
      };
      group.addEventListener('click', () => {
        if (!moved) select();
      });
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          select();
        }
      });
      svg.append(group);
      return { group, axis, i, sign, depth: 0 };
    }),
  );
  const update = () => {
    inverse.copy(camera.quaternion).invert();
    for (const point of points) {
      const v = point.axis.v.clone().multiplyScalar(point.sign).applyQuaternion(inverse);
      const x = 50 + v.x * 32,
        y = 50 - v.y * 32;
      point.depth = v.z;
      point.group.setAttribute('transform', `translate(${x} ${y})`);
      point.group.setAttribute('opacity', v.z < -0.1 ? '.65' : '1');
      if (point.sign > 0) {
        lines[point.i].setAttribute('x2', String(x));
        lines[point.i].setAttribute('y2', String(y));
      }
    }
    [...points].sort((a, b) => a.depth - b.depth).forEach((p) => svg.append(p.group));
  };
  let dragging = false,
    moved = false,
    lastX = 0,
    lastY = 0;
  svg.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    dragging = true;
    moved = false;
    lastX = event.clientX;
    lastY = event.clientY;
  });
  svg.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX,
      dy = event.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) < 2) return;
    svg.setPointerCapture(event.pointerId);
    moved = true;
    lastX = event.clientX;
    lastY = event.clientY;
    const spherical = new Spherical().setFromVector3(camera.position.clone().sub(orbit.target));
    spherical.theta -= dx * 0.012;
    spherical.phi -= dy * 0.012;
    spherical.makeSafe();
    camera.position.copy(orbit.target).add(new Vector3().setFromSpherical(spherical));
    orbit.update();
  });
  svg.addEventListener('pointerup', (event) => {
    dragging = false;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  });
  svg.addEventListener('pointercancel', () => {
    dragging = false;
  });
  host.append(svg);
  orbit.addEventListener('change', update);
  update();
  return () => {
    orbit.removeEventListener('change', update);
    svg.remove();
  };
}
