module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    'babel-plugin-react-compiler',
    // Worklets plugin MUST be last
    'react-native-worklets/plugin',
  ],
};
