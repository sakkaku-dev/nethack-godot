import { BehaviorSubject, Subject, debounceTime, filter, firstValueFrom, skip, tap } from "rxjs";
import { Item, NetHackJS, Status, NetHackUI, Tile, GameState, InventoryItem } from "./models";
import { ATTR, MENU_SELECT, STATUS_FIELD, WIN_TYPE } from "./generated";

// @ts-ignore
import nethackLib from "../lib/nethack.js";

import { Command, ItemFlag, statusMap } from "./nethack-models";
import { AccelIterator } from "./helper/accel-iterator";
import { NethackUtil, Type } from "./helper/nethack-util";
import {
  EMPTY_ITEM,
  clearMenuItems,
  getCountForSelect,
  setAccelerators,
  toggleMenuItems,
} from "./helper/menu-select";
import { listBackupFiles, loadRecords, loadSaveFiles, syncSaveFiles } from "./helper/save-files";
import { CONTINUE_KEYS, ENTER, ESC, SPACE } from "./helper/keys";
import { toInventoryItem } from "./helper/inventory";
import { createConditionStatusText, createStatusText } from "./helper/visual";
import { Settings, TileSetImage, loadSettings, updateSettings } from "./helper/settings";

const ASCII_MAX = 127;
const MAX_STRING_LENGTH = 256; // defined in global.h BUFSZ

enum InputType {
  ALL,
  CONTINUE,
  ASCII,
  ESCAPE,
}


export class NetHackWrapper implements NetHackJS {
  private commandMap: Partial<Record<Command, (...args: any[]) => Promise<any>>> = {
    [Command.CREATE_WINDOW]: this.createWindow.bind(this),
    [Command.DESTROY_WINDOW]: async (winid: number) => this.ui.closeDialog(winid),
    [Command.CLEAR_WINDOW]: this.clearWindow.bind(this),
    // [Command.EXIT_WINDOWS]: this.exitWindows.bind(this),
    [Command.GAME_END]: this.gameEnd.bind(this),

    // Text / Dialog
    [Command.PUTSTR]: this.handlePutStr.bind(this),
    [Command.RAW_PRINT]: async (str) => this.handlePrintLine(ATTR.ATR_NONE, str),
    [Command.RAW_PRINT_BOLD]: async (str) => this.handlePrintLine(ATTR.ATR_BOLD, str),

    // Map
    [Command.PRINT_GLYPH]: async (winid, x, y, glyph, bkglyph) => {
      this.tiles$.next([...this.tiles$.value, { x, y, tile: this.util.toTile(glyph) }]);
      if (bkglyph !== 0 && bkglyph !== 5991) {
        console.log(
          `%c Background Tile found! ${bkglyph}, ${this.util.toTile(bkglyph)}`,
          "background: #222; color: #bada55"
        );
      }
    },

    [Command.CURSOR]: async (winid, x, y) =>
      winid == this.global.globals.WIN_MAP && this.ui.moveCursor(x, y),
    [Command.CLIPAROUND]: async (x, y) => this.ui.centerView(x, y),

    // Status
    [Command.STATUS_UPDATE]: this.statusUpdate.bind(this),
    [Command.STATUS_ENABLE_FIELD]: this.statusEnableField.bind(this),

    // Menu
    [Command.MENU_START]: async () => (this.menuItems = []),
    [Command.MENU_END]: async (winid, prompt) => (this.menuPrompt = prompt),
    [Command.MENU_ADD]: this.menuAdd.bind(this),
    [Command.MENU_SELECT]: this.menuSelect.bind(this),

    // Waiting input
    [Command.DISPLAY_WINDOW]: this.displayWindow.bind(this),
    [Command.GET_CHAR]: () => this.waitForNextAction(),
    [Command.GET_POSKEY]: () => this.waitForNextAction(),
    [Command.YN_FUNCTION]: this.yesNoQuestion.bind(this),
    [Command.GET_LINE]: this.getLine.bind(this),
    [Command.GET_EXT_CMD]: this.getExtCmd.bind(this),

    // according to window.doc, a 50ms delay, but add more since drawing the tile takes longer
    [Command.DELAY_OUTPUT]: () => new Promise((resolve) => setTimeout(resolve, 100)),
    [Command.MESSAGE_MENU]: this.messageMenu.bind(this),

    // TODO: select_menu with yn_function
  };
  private idCounter = 0;
  private menuItems: Item[] = [];
  private menuPrompt = "";
  private putStr = "";
  private putStrWinId = 0;
  private backupFile = "";
  private accel = new AccelIterator();
  private status: Status = {};

  private input$ = new Subject<number>();
  private line$ = new Subject<string>();

  private inventory$ = new Subject<InventoryItem[]>();
  private tiles$ = new BehaviorSubject<Tile[]>([]);
  private awaitingInput$ = new BehaviorSubject(false);
  private gameState$ = new BehaviorSubject(GameState.START);

  constructor(
    private debug = false,
    private module: any,
    private util: NethackUtil,
    private win: typeof window = window,
    private autostart = true
  ) {
    this.gameState$.pipe(tap((s) => this.ui.updateState(s))).subscribe();

    this.tiles$
      .pipe(
        skip(1),
        filter((x) => x.length > 0),
        debounceTime(100),
        tap((tiles) => this.ui.updateMap(...tiles)),
        tap(() => this.tiles$.next([]))
      )
      .subscribe();

    this.inventory$
      .pipe(
        filter((x) => x.length > 0),
        debounceTime(100),
        tap((items) => this.ui.updateInventory(...items))
      )
      .subscribe();

    this.input$.subscribe(() => this.awaitingInput$.next(false));

    this.win.nethackCallback = this.handle.bind(this);
    this.win.onbeforeunload = (e) => {
      if (this.isGameRunning()) {
        // TODO: auto save?
        return (e.returnValue = "Game progress will be lost if not saved.");
      }
    };

    this.win.onerror = (e) => {
      if (this.isGameRunning()) {
        const title = "An unexpected error occurred.";
        const unsaved = "Unfortunately the game progress could not be saved.";
        const backup =
          'Use the "Load from backup" in the main menu to restart from your latest save.';
        this.ui.openDialog(-1, `${title}\n${unsaved}\n\n${backup}`);
        this.waitInput(InputType.CONTINUE).then(() => {
          this.ui.closeDialog(-1);
          this.gameState$.next(GameState.GAMEOVER);
        });
      }
    };

    if (!this.module.preRun) {
      this.module.preRun = [];
    }
    this.module.preRun.push(() => loadSaveFiles(this.module, this.backupFile));

    if (autostart) {
      this.openStartScreen();
    }
  }

  private async openStartScreen() {
    while (!this.isGameRunning()) {
      const actions = [async () => this.startGame()];
      const startMenu = ["Start Game"];

      const files = listBackupFiles();
      if (files.length > 0) {
        startMenu.push("Load from backup");
        actions.push(async () => {
          const backupId = await this.openCustomMenu("Select backup file", files);
          if (backupId !== -1) {
            this.backupFile = files[backupId];
            this.startGame();
          }
        });
      }

      startMenu.push('Options');
      actions.push(() => this.options());

      const records = loadRecords();
      if (records.length) {
        startMenu.push("Leaderboard");
        actions.push(async () => {
          this.ui.openDialog(-1, records);
          await this.waitInput(InputType.CONTINUE);
          this.ui.closeDialog(-1);
        });
      }

      const id = await this.openCustomMenu("Welcome to NetHack", startMenu);
      if (id !== -1) {
        await actions[id]();
      }
    }

    this.ui.closeDialog(-1);
  }

  private async options() {
    let cancel = false;
    do {
      const settings = loadSettings();
      const options = [`Enable map border - [${settings.enableMapBorder}]`, `Tileset - ${settings.tileSetImage}`];
      const optionActions = [async () => updateSettings(settings, s => s.enableMapBorder = !s.enableMapBorder), () => this.tilesetOption(settings)];
      const optionId = await this.openCustomMenu("Options", options);
      if (optionId === -1) {
        cancel = true;
      } else {
        await optionActions[optionId]();
      }
    } while (!cancel);
  }

  private async tilesetOption(settings: Settings) {
    const images = Object.values(TileSetImage);
    const idx = await this.openCustomMenu('Tileset Image', images);
    if (idx !== -1) {
      updateSettings(settings, s => s.tileSetImage = images[idx]);
    }
  }

  private async startGame() {
    this.gameState$.next(GameState.RUNNING);
    await nethackLib(this.module);
    this.ui.updateSettings(loadSettings());
  }

  private async openCustomMenu(prompt: string, buttons: string[]) {
    const items = buttons.map((file, i) => ({
      ...EMPTY_ITEM,
      str: file,
      identifier: i + 1,
    }));
    const ids = await this.startUserMenuSelect(-1, prompt, MENU_SELECT.PICK_ONE, items);
    if (ids.length) {
      return ids[0] - 1;
    }

    return -1;
  }

  private isGameRunning() {
    return this.gameState$.value === GameState.RUNNING;
  }

  private log(...args: any[]) {
    if (this.debug) {
      console.log(...args);
    }
  }

  // Getting input from user

  public async sendInput(...keys: (number | string)[]) {
    for (const key of keys) {
      const k = typeof key === "string" ? key.charCodeAt(0) : key;
      this.log("Sending input", k);
      this.input$.next(k);
      await this.waitForAwaitingInput();
    }
  }

  public sendLine(line: string) {
    if (line.length >= MAX_STRING_LENGTH) {
      this.log(`Line is too long. It can only be ${MAX_STRING_LENGTH} characters long.`, line);
    } else {
      this.line$.next(line);
    }
  }

  // Waiting for input from user

  private async waitInput(type = InputType.ALL) {
    this.awaitingInput$.next(true);
    return await firstValueFrom(
      this.input$.pipe(
        filter(
          (c) => {
            switch (type) {
              case InputType.CONTINUE:
                return CONTINUE_KEYS.includes(c);
              case InputType.ASCII:
                return c <= ASCII_MAX;
              case InputType.ESCAPE:
                return c === ESC;
              default:
                return true;
            }
          }
        )
      )
    );
  }

  private async waitLine() {
    this.awaitingInput$.next(true);
    return await firstValueFrom(this.line$);
  }

  private async waitForAwaitingInput() {
    return await firstValueFrom(this.awaitingInput$.pipe(filter((x) => x)));
  }

  private async waitForNextAction() {
    const code = await this.waitInput();
    if (code === "i".charCodeAt(0)) {
      this.ui.toggleInventory();
    }

    return code;
  }

  // Commands

  async handle(cmd: Command, ...args: any[]) {
    this.log(cmd, args);

    const commandHandler = this.commandMap[cmd];
    if (commandHandler) {
      return commandHandler(...args);
    }

    if (cmd == Command.GET_HISTORY) {
      return "";
    }

    return -1;
  }

  private async messageMenu(dismissAccel: string, how: number, mesg: string) {
    // Just information? currently known usage with (z)ap followed by (?)
    this.ui.printLine(mesg);
  }

  private async getExtCmd(commandPointer: number, numCommands: number) {
    const commands = this.getArrayValue(commandPointer, numCommands);
    this.ui.openGetLine("#", ...commands);
    const line = await this.waitLine();
    const idx = commands.findIndex((x) => x === line);

    this.ui.closeDialog(-1);
    if (idx >= 0 && idx < commands.length) {
      return idx;
    }

    return -1;
  }

  private async getLine(question: string, searchPointer: number) {
    this.ui.openGetLine(question);
    const line = await this.waitLine();
    const ptr = this.global.helpers.getPointerValue("nethack.getLine", searchPointer, Type.POINTER);
    this.global.helpers.setPointerValue("nethack.getLine", ptr, Type.STRING, line);
    this.ui.closeDialog(-1);
  }

  private async yesNoQuestion(question: string, choices: string, defaultChoice: number) {
    // const m = question.split(/\s+\[([\$a-zA-Z\-]+)(\sor\s[\*\?]+)\]/);
    const m = question.split(/\s+\[([\$a-zA-Z\s\-\*\?]+)\]/);
    if (m.length >= 2) {
      question = m[0];
      choices = m[1];
    }

    let allChoices: string | string[] = choices;
    if (
      !!choices &&
      !choices.includes("-") &&
      !choices.includes(" or ") &&
      !choices.includes("*")
    ) {
      allChoices = choices.split("");
    }

    if (allChoices === '' || Array.isArray(allChoices)) {
      this.ui.openQuestion(question, String.fromCharCode(defaultChoice), ...allChoices);
    } else {
      this.ui.openQuestion(question, String.fromCharCode(defaultChoice), allChoices);
    }

    let c = 0;
    do {
      c = await this.waitInput(InputType.ALL);

      // Default behaviour described in window.doc
      if (c === ESC) {
        if (choices.includes("q")) {
          c = "q".charCodeAt(0);
        } else if (choices.includes("n")) {
          c = "n".charCodeAt(0);
        } else {
          c = defaultChoice;
        }
        break;
      } else if ([SPACE, ENTER].includes(c)) {
        c = defaultChoice;
        break;
      }

      // TODO: handle choice #, allows numbers
    } while (Array.isArray(allChoices) && !allChoices.includes(String.fromCharCode(c)));

    this.ui.closeDialog(-1);
    return c;
  }

  private async createWindow(type: WIN_TYPE) {
    this.idCounter++;
    return this.idCounter;
  }

  private async displayWindow(winid: number, blocking: number) {
    if (this.putStr !== "") {
      if (this.putStrWinId === winid) {
        this.ui.openDialog(winid, this.putStr);
        await this.waitInput(InputType.CONTINUE);
        this.putStr = "";
      } else {
        this.log("putStr has value but another window is displayed", winid);
      }
    }
  }

  private async clearWindow(winid: number) {
    if (winid === this.global.globals.WIN_MAP) {
      this.ui.clearMap();
    }
    this.putStr = "";
  }

  private async gameEnd(status: number) {
    this.log("Ended game with status", status);
    syncSaveFiles(this.module);
    this.gameState$.next(GameState.GAMEOVER);
  }

  private async menuAdd(
    winid: number,
    glyph: number,
    identifier: number,
    accelerator: number,
    groupAcc: number,
    attr: number,
    str: string,
    flag: number
  ) {
    this.menuItems.push({
      tile: this.util.toTile(glyph),
      identifier,
      accelerator,
      groupAcc,
      attr,
      str,
      active: flag === ItemFlag.SELECTED,
    });
  }

  private async menuSelect(winid: number, select: MENU_SELECT, selected: number) {
    if (winid === this.global.globals.WIN_INVEN) {
      const items = this.menuItems.map((i) => toInventoryItem(i));
      this.inventory$.next(items);
      return 0;
    }

    if (this.menuItems.length === 0) {
      return 0;
    }

    const itemIds = await this.startUserMenuSelect(winid, this.menuPrompt, select, this.menuItems);
    this.ui.closeDialog(winid); // sometimes it's not closed
    if (itemIds.length === 0) {
      return -1;
    }

    this.util.selectItems(itemIds, selected);
    return itemIds.length;
  }

  private async handlePutStr(winid: number, attr: any, str: string) {
    // if (winid === this.global.globals.WIN_STATUS) {
    //   const status = this.status$.value;
    //   parseAndMapStatus(str, status);
    //   this.status$.next(status);
    if (winid === this.global.globals.WIN_MESSAGE) {
      this.handlePrintLine(attr, str);
    } else {
      if (this.putStrWinId !== winid) {
        this.log("putStr value changed without displaying it", str, winid);
        this.putStr = "";
      }

      this.putStr += str + "\n";
      this.putStrWinId = winid;
    }
  }

  private handlePrintLine(attr: ATTR, str: string) {
    if (str.match(/You die/)) {
      this.gameState$.next(GameState.DIED);
    }
    this.ui.printLine(str);
  }

  private async statusEnableField(
    type: STATUS_FIELD,
    name: number,
    format: number,
    enable: number
  ) {
    if (!enable) {
      statusMap[type](this.status, undefined);
    }
  }

  private async statusUpdate(
    type: STATUS_FIELD,
    ptr: number,
    chg: number,
    percentage: number,
    color: number,
    colormasks: number
  ) {
    if (type === STATUS_FIELD.BL_FLUSH) {
      this.ui.updateStatus(this.status);
      return;
    }

    const mapper = statusMap[type];
    if (mapper) {
      if (type == STATUS_FIELD.BL_CONDITION) {
        const conditionBits: number = this.global.helpers.getPointerValue("status", ptr, Type.INT);
        this.status.condition = createConditionStatusText(conditionBits, colormasks);
        console.log(STATUS_FIELD[type], conditionBits, this.status.condition);
      } else {
        const text = this.global.helpers.getPointerValue("status", ptr, Type.STRING);
        mapper(this.status, createStatusText(text, color));
        console.log(STATUS_FIELD[type], text);
      }
    } else {
      this.log("Unhandled status type", STATUS_FIELD[type]);
    }
  }

  // Utils
  private async startUserMenuSelect(
    id: number,
    prompt: string,
    select: MENU_SELECT,
    items: Item[]
  ) {
    setAccelerators(items, this.accel);

    const count = getCountForSelect(select);
    let char = 0;

    while (!CONTINUE_KEYS.includes(char)) {
      this.ui.openMenu(id, prompt, count, ...items);
      char = await this.waitInput(InputType.ASCII);

      if (count !== 0) {
        toggleMenuItems(char, count, items);

        if (count === 1 && items.some((i) => i.active)) {
          break;
        }
      }
    }

    if (char === ESC) {
      clearMenuItems(items);
    }

    return items.filter((i) => i.active).map((i) => i.identifier);
  }

  private getPointerValue(ptr: number, type: string) {
    const x = this.global.helpers.getPointerValue("nethack.pointerValue", ptr, Type.POINTER);
    return this.global.helpers.getPointerValue("nethack.pointerValue", x, type);
  }

  // ptr should be a pointer to a pointer
  private getArrayValue(ptr: number, length: number): any[] {
    const arr: any[] = [];
    const pointer = this.global.helpers.getPointerValue("nethack.arrayValue", ptr, Type.POINTER);
    for (let i = 0; i < length; i++) {
      const value = this.getPointerValue(pointer + i * 4, Type.STRING);
      arr.push(value);
    }

    return arr;
  }

  private get global() {
    return this.win.nethackGlobal;
  }

  private get ui(): NetHackUI {
    return this.win.nethackUI;
  }
}
