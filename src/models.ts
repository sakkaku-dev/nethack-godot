export interface NetHackJS {
  selectMenu: (items: any[]) => void; // TODO: param type
  sendInput: (key: number) => void;
  startGame: () => void;
}

// In Godot all parameters will be in one array, so don't nest them
export interface NetHackUI {
  openMenu: (id: number, prompt: string, count: number, ...items: Item[]) => void;
  openDialog: (id: number, msg: string) => void;
  openQuestion: (question: string, ...choices: string[]) => void;

  closeDialog: (id: number) => void;

  moveCursor: (x: number, y: number) => void;
  centerView: (x: number, y: number) => void;
  printLine: (msg: string) => void;

  updateMap: (...tiles: Tile[]) => void;
  updateStatus: (status: Status) => void;
  updateInventory: (...items: Item[]) => void;
}

export interface Vector {
  x: number;
  y: number;
}

export function add(v1: Vector, v2: Vector): Vector {
  return { x: v1.x + v2.x, y: v1.y + v2.y };
}

export function sub(v1: Vector, v2: Vector): Vector {
  return { x: v1.x - v2.x, y: v1.y - v2.y };
}

export function mult(v1: Vector, v2: Vector): Vector {
  return { x: v1.x * v2.x, y: v1.y * v2.y };
}

export interface Tile {
  x: number;
  y: number;
  tile: number;
}

export interface Item {
  tile: number;
  accelerator: number;
  groupAcc: string;
  attr: number;
  str: string;
  identifier: number;
  active: boolean;
}

// See botl.c
interface StatusAll {
  str: string; // Strength can be like 18/50
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;

  title: string;
  align: string;

  gold: number;
  power: number;
  powerMax: number;
  exp: number;
  expLvl: number;
  armor: number;
  hp: number;
  hpMax: number;

  score: string;
  carryCap: string;
  hunger: string;
  dungeonLvl: string;
  condition?: string;

  // TODO: ??
  hd: any;
  time: any;
}

export type Status = Partial<StatusAll>;
