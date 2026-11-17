# Chat UI

Vite + React + TypeScript chat UI for the local chatbot backend at `http://localhost:3000`.

## Authentication

- On first load the app shows **Log in** / **Sign up** tabs.
  - **Log in** posts `{ email, password }` to `POST /login`.
  - **Sign up** posts `{ name, password, email, role, mobileNumber, country }` to `POST /register`. `role` is always sent as `"user"` and is shown as a fixed, non-editable field — the backend ignores client-supplied roles, so self-registration cannot grant elevated privileges. `country` is chosen from a dropdown that shows each country's name with its STD/dial code (for example `India (+91)`), defaults to `India`, and is sent as the country name only. `mobileNumber` accepts exactly 10 digits (non-digits are stripped, including on paste) and is sent as the bare digits without the dial code. A successful registration switches back to the Login tab with a confirmation message; it does **not** auto-login.
- Client-side validation checks required fields, email format, and that the mobile number is exactly 10 digits. Server `{ error }` responses, validation messages, and connection failures are shown in an accessible `role="alert"` region; submit buttons are disabled while a request is pending.
- A successful login stores the returned JWT in `localStorage` under `chatbot_token` and the basic user record under `chatbot_user`. On app load the stored token restores the session directly (no `/me` call). **Log out** in the chat header clears both keys and returns to the auth forms.
- `POST /chat` and `POST /upload` now send `Authorization: Bearer <JWT>` alongside their existing headers/bodies. If either returns **401**, the stored credentials are cleared and the UI returns to Login.

The SSE contract (`user_message`, `token`, `complete`, `error`), upload validation (PDF/DOCX/CSV/XLS/XLSX up to 20 MB), and context-mode badges are unchanged.

## React + TypeScript + Vite template notes

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
