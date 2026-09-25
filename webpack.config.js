const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
module.exports = {
  entry: './src/module.tsx',
  output: {path: path.resolve(__dirname, 'dist'), filename: 'module.js', libraryTarget: 'amd', clean: true},
  resolve: {extensions: ['.tsx', '.ts', '.js']},
  module: {rules: [{test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/}]},
  externals: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@grafana/data', '@grafana/runtime', '@grafana/ui'],
  plugins: [new CopyPlugin({patterns: [{from: 'src/plugin.json'}, {from: 'src/img', to: 'img'}, {from: 'README.md'}, {from: 'docs', to: 'docs'}]})],
};
