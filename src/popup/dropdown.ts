/**
 * An animated dropdown built on top of a native <select>. The select stays in the page and keeps
 * the value, so the popup code is unchanged. This file draws the button and the animated list.
 *
 * Mouse: a click on the button opens or closes the list. A click on an item chooses it.
 * Keyboard: Arrow keys move, Home and End jump, Enter or Space choose, Escape or Tab close.
 *
 * The list closes only when you click outside it, press a key that closes it, or choose an item.
 * Scrolling the list never closes it. Scrolling the page moves the list so it stays by its button.
 */

interface Entry {
  el: HTMLElement;
  option: HTMLOptionElement;
}

const GAP = 4;
let openDropdown: Dropdown | null = null;
let panelSequence = 0;

export class Dropdown {
  private readonly button = document.createElement("button");
  private readonly value = document.createElement("span");
  private panel: HTMLDivElement | null = null;
  private entries: Entry[] = [];
  private active = -1;

  constructor(private readonly select: HTMLSelectElement) {
    this.button.type = "button";
    this.button.className = "dd-button";
    this.button.setAttribute("role", "combobox");
    this.button.setAttribute("aria-haspopup", "listbox");
    this.button.setAttribute("aria-expanded", "false");
    const labelledBy = select.getAttribute("aria-labelledby");
    if (labelledBy) this.button.setAttribute("aria-labelledby", labelledBy);
    this.value.className = "dd-value";
    this.button.append(this.value);

    select.classList.add("dd-source");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    select.after(this.button);

    this.button.addEventListener("click", () => (this.panel ? this.close(true) : this.open()));
    this.button.addEventListener("keydown", (event) => {
      // Enter and Space already make the browser send a click, so only the arrow keys open here.
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !this.panel) {
        event.preventDefault();
        this.open();
      }
    });
    this.refresh();
  }

  /** Copies the selected option's text and the disabled options into the button and the open list. */
  refresh(): void {
    this.value.textContent = this.select.selectedOptions[0]?.textContent ?? "";
    this.button.disabled = this.select.disabled;
    for (const entry of this.entries) {
      entry.el.setAttribute("aria-selected", String(entry.option.selected));
      entry.el.setAttribute("aria-disabled", String(entry.option.disabled));
    }
  }

  private open(): void {
    if (openDropdown && openDropdown !== this) openDropdown.close(false);
    openDropdown = this;
    const panel = document.createElement("div");
    panel.className = "dd-panel";
    panel.id = `dd-panel-${++panelSequence}`;
    panel.setAttribute("role", "listbox");
    this.button.setAttribute("aria-controls", panel.id);
    this.entries = [];
    let index = 0;
    for (const child of Array.from(this.select.children)) {
      if (child instanceof HTMLOptGroupElement) {
        const label = document.createElement("div");
        label.className = "dd-group";
        label.textContent = child.label;
        panel.append(label);
        for (const option of Array.from(child.children) as HTMLOptionElement[]) panel.append(this.entry(option, index++));
      } else if (child instanceof HTMLOptionElement) {
        panel.append(this.entry(child, index++));
      }
    }
    document.body.append(panel);
    this.panel = panel;
    this.button.setAttribute("aria-expanded", "true");
    this.place();
    this.setActive(Math.max(0, this.entries.findIndex((e) => e.option.selected)));
    requestAnimationFrame(() => panel.classList.add("is-open"));
    document.addEventListener("pointerdown", this.onOutside, true);
    document.addEventListener("keydown", this.onKey, true);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("scroll", this.onScroll, true);
  }

  private entry(option: HTMLOptionElement, index: number): HTMLElement {
    const el = document.createElement("div");
    el.className = "dd-option";
    el.setAttribute("role", "option");
    el.id = `${this.button.getAttribute("aria-controls") ?? "dd-panel"}-opt-${index}`;
    el.style.setProperty("--i", String(index));
    el.textContent = option.textContent ?? "";
    // Hovering only highlights. It does not scroll the list, so the list never moves under the pointer.
    el.addEventListener("pointerenter", () => {
      if (!option.disabled) this.setActive(index, false);
    });
    el.addEventListener("click", () => this.choose(option));
    this.entries.push({ el, option });
    el.setAttribute("aria-selected", String(option.selected));
    el.setAttribute("aria-disabled", String(option.disabled));
    return el;
  }

  close(refocus: boolean): void {
    const panel = this.panel;
    if (!panel) return;
    this.panel = null;
    this.active = -1;
    panel.classList.remove("is-open");
    this.button.setAttribute("aria-expanded", "false");
    this.button.removeAttribute("aria-controls");
    this.button.removeAttribute("aria-activedescendant");
    document.removeEventListener("pointerdown", this.onOutside, true);
    document.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("scroll", this.onScroll, true);
    if (openDropdown === this) openDropdown = null;
    window.setTimeout(() => panel.remove(), 260);
    if (refocus) this.button.focus({ preventScroll: true });
  }

  private choose(option: HTMLOptionElement): void {
    if (option.disabled) return;
    this.select.value = option.value;
    this.select.dispatchEvent(new Event("change", { bubbles: true }));
    this.refresh();
    this.close(true);
  }

  /** Puts the list just below the button, or just above it when there is no room below. */
  private place(): void {
    if (!this.panel) return;
    const box = this.button.getBoundingClientRect();
    const below = window.innerHeight - box.bottom - GAP;
    const above = box.top - GAP;
    const openUp = below < 200 && above > below;
    this.panel.style.left = `${box.left}px`;
    this.panel.style.width = `${box.width}px`;
    this.panel.style.maxHeight = `${Math.min(280, openUp ? above : below)}px`;
    this.panel.dataset.side = openUp ? "up" : "down";
    if (openUp) {
      this.panel.style.top = "";
      this.panel.style.bottom = `${window.innerHeight - box.top + GAP}px`;
    } else {
      this.panel.style.bottom = "";
      this.panel.style.top = `${box.bottom + GAP}px`;
    }
  }

  /** Scrolls only the list, never the page, so the chosen item is fully visible. */
  private reveal(el: HTMLElement): void {
    const panel = this.panel;
    if (!panel) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < panel.scrollTop) panel.scrollTop = top;
    else if (bottom > panel.scrollTop + panel.clientHeight) panel.scrollTop = bottom - panel.clientHeight;
  }

  private setActive(index: number, reveal = true): void {
    this.entries.forEach((entry, i) => entry.el.classList.toggle("is-active", i === index));
    this.active = index;
    const el = this.entries[index]?.el;
    if (el) this.button.setAttribute("aria-activedescendant", el.id);
    if (el && reveal) this.reveal(el);
  }

  private step(direction: 1 | -1): void {
    let next = this.active;
    for (let i = 0; i < this.entries.length; i++) {
      next = (next + direction + this.entries.length) % this.entries.length;
      if (!this.entries[next]?.option.disabled) break;
    }
    this.setActive(next);
  }

  private readonly onOutside = (event: PointerEvent): void => {
    const target = event.target as Node | null;
    if (this.panel?.contains(target) || this.button.contains(target)) return;
    this.close(false);
  };

  /** The window was resized: keep the list next to its button. */
  private readonly onResize = (): void => this.place();

  /** Something scrolled. Scrolling inside the list is allowed; any other scroll moves the list to its button. */
  private readonly onScroll = (event: Event): void => {
    const target = event.target;
    if (target instanceof Node && this.panel?.contains(target)) return;
    this.place();
  };

  private readonly onKey = (event: KeyboardEvent): void => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape"];
    if (keys.includes(event.key)) event.preventDefault();
    if (event.key === "Escape") this.close(true);
    else if (event.key === "ArrowDown") this.step(1);
    else if (event.key === "ArrowUp") this.step(-1);
    else if (event.key === "Home") this.setActive(0);
    else if (event.key === "End") this.setActive(this.entries.length - 1);
    else if (event.key === "Enter" || event.key === " ") {
      const entry = this.entries[this.active];
      if (entry) this.choose(entry.option);
    } else if (event.key === "Tab") this.close(false);
  };
}
