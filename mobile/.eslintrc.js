module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    ecmaFeatures: { jsx: true },
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin', 'prettier'],
  extends: ['@react-native', 'plugin:@typescript-eslint/recommended', 'plugin:prettier/recommended'],
  env: { es2022: true, node: true, jest: true },
  ignorePatterns: ['.eslintrc.js', 'node_modules', 'android', 'ios', 'coverage'],
  settings: {
    react: { version: '18.3' },
  },
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-console': 'warn',
    // `void somePromise()` is how this codebase marks an intentionally
    // unawaited promise, so the rule fights the convention.
    'no-void': 'off',
    'react-native/no-inline-styles': 'warn',
  },
  overrides: [
    {
      files: ['*.js'],
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
  ],
};