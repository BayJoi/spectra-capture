/**
 * One custom control system for every button in the popup and the guide.
 *
 * A button is always a real <button> element: keyboard activation, focus, disabled state and
 * assistive-technology semantics come from the browser. The custom layer adds a press plate and
 * an icon slot; if CSS fails to load the native button still works. All buttons in this project
 * are declared in HTML and upgraded here, so the markup stays readable and the fallback is native.
 */

/** Upgrades the static buttons already in the document to the shared custom language. */
export function hydrateButtons(root: ParentNode = document): void {
  const selector =
    "button.primary, button.ghost, button.swap, button.tab, button.theme-switch, button.dd-button, .btn-row button";
  for (const button of root.querySelectorAll<HTMLButtonElement>(selector)) {
    if (button.classList.contains("ui-btn")) continue;
    button.classList.add("ui-btn");
    if (!button.querySelector(".ui-btn__press")) {
      const press = document.createElement("span");
      press.className = "ui-btn__press";
      press.setAttribute("aria-hidden", "true");
      button.append(press);
    }
    if (button.classList.contains("swap") && !button.querySelector(".ui-btn__icon")) {
      const svg = button.querySelector("svg");
      if (svg) {
        svg.classList.add("ui-btn__icon");
        svg.setAttribute("aria-hidden", "true");
      }
    }
  }
}
