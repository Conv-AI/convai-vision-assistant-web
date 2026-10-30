/** The app's version from package.json, set when it is built (Settings › About). */
declare const __APP_VERSION__: string;

/** The production dependencies' licenses, read when the app is built (`scripts/licenses.mjs`). */
declare module 'virtual:licenses' {
  const licenses: readonly {
    name: string;
    version: string;
    /** As the package names it ("MIT", "(Apache-2.0 AND BSD-3-Clause)"). */
    license: string;
    /** Its license file, or null when it ships none. */
    text: string | null;
  }[];
  export default licenses;
}
