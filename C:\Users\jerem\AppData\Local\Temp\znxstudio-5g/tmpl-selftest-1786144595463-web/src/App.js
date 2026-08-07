import { html, createState } from "@zoijs/core";

export function App() {
  const count = createState(0);

  return html`
    <main>
      <h1>Hello tmpl-selftest-1786144595463-web</h1>
      <button onclick=${() => count.set(count.get() + 1)}>
        Count: ${() => count.get()}
      </button>
    </main>
  `;
}
