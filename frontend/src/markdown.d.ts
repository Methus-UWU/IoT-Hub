/**
 * `.md` files are loaded as plain text by the build (see the `loader` entry in
 * `angular.json`), so an import yields the raw Markdown source as a string.
 */
declare module '*.md' {
  const content: string;
  export default content;
}
