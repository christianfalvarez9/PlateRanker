/// <reference types="react" />
/// <reference types="react-dom" />

// Fallback to prevent editor-only JSX intrinsic errors before dependencies are installed.
// Once `npm install` is run in the workspace, React's full JSX types take precedence.
declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}
