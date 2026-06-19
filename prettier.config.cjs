/** @type {import("prettier").Config} */
module.exports = {
  plugins: ["@trivago/prettier-plugin-sort-imports"],
  importOrder: [
    "<BUILTIN_MODULES>",
    "<THIRD_PARTY_MODULES>",
    "^@/(.*)$",
    "^[./]",
  ],
  importOrderCaseInsensitive: true,
  importOrderSeparation: true,
  importOrderSideEffects: false,
  importOrderSortSpecifiers: true,
};
