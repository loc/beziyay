interface Window {
    lines: any[];
}

window.lines = [];

let isDrawing = false;

window.addEventListener('mousedown', ({ pageX: x, pageY: y }) => {
    isDrawing = true;
    window.lines.push([{ x, y }]);
});

window.addEventListener('mousemove', ({ pageX: x, pageY: y }) => {
    if (!isDrawing) return;
    window.lines[window.lines.length - 1].push({ x, y });
});

window.addEventListener('mouseup', () => {
    isDrawing = false;
});
