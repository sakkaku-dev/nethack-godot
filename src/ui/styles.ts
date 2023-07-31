export function fullScreen(elem: HTMLElement) {
    elem.style.position = 'absolute';
    elem.style.top = '0';
    elem.style.left = '0';
    elem.style.right = '0';
    elem.style.bottom = '0';
}

export function topLeft(elem: HTMLElement) {
    elem.style.position = 'absolute';
    elem.style.top = '0';
    elem.style.left = '0';
}

export function topRight(elem: HTMLElement) {
    elem.style.position = 'absolute';
    elem.style.top = '0';
    elem.style.right = '0';
}

export function center(elem: HTMLElement) {
    elem.style.display = 'flex';
    elem.style.justifyContent = 'center';
    elem.style.alignItems = 'center';
}

export function vert(elem: HTMLElement) {
    elem.style.display = 'flex';
    elem.style.gap = '1rem';
    elem.style.flexDirection = 'column';
}

export function horiz(elem: HTMLElement) {
    elem.style.display = 'flex';
    elem.style.flexDirection = 'row';
    elem.style.gap = '0.5rem';
    elem.style.alignItems = 'center';
}

export function rel(elem: HTMLElement) {
    elem.style.position = 'relative';
}

export function accelStyle(elem: HTMLElement) {
    topRight(elem);
    elem.style.background = '#00000099';
    elem.style.padding = '0 0.1rem';
}

export function title(elem: HTMLElement) {
    elem.style.fontSize = '1.5rem';
    elem.style.fontWeight = 'bold';
    elem.style.padding = '0.5rem 1rem';
}

export function grid(elem: HTMLElement, col: number) {
    elem.style.display = 'grid';
    elem.style.gap = '0.5rem';
    elem.style.gridTemplateColumns = `repeat(${col}, minmax(0, 1fr))`;
}

export function pointer(elem: HTMLElement) {
    elem.style.cursor = 'pointer';
}

export function bucState(elem: HTMLElement, text: string) {
    const str = text.toLowerCase();
    if (str.match(/(?<!un)cursed/) || str.includes('unholy')) {
        elem.classList.add('cursed');
    } else if (str.includes('blessed')) {
        elem.classList.add('blessed');
    }
}
