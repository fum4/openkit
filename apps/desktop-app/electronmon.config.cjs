module.exports = {
  patterns: [
    // Watch compiled electron files
    "./dist/**/*.js",
    // Watch compiled backend (for when it changes server behavior)
    "../cli/dist/**/*.js",
  ],
  ignore: [
    // Don't watch UI files - they have their own HMR
    "../../apps/web-app/dist/**",
    // Legacy fallback for older root dist/ui layout.
    "../../dist/ui/**",
    "../../dist/shell/**",
    // Don't watch source files - we watch compiled output
    "../../apps/**",
    "../../libs/**",
    // Don't watch node_modules
    "../../node_modules/**",
  ],
};
