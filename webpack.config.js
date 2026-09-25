const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const shared = {
  resolve: {extensions: ['.tsx', '.ts', '.js']},
  module: {rules: [{test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/}]},
  externals: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@grafana/data', '@grafana/runtime', '@grafana/ui'],
};
module.exports = [
  {
    ...shared,
    name: 'datasource',
    entry: './src/module.tsx',
    output: {path: path.resolve(__dirname, 'dist/dataspacelab-dil-datasource'), filename: 'module.js', libraryTarget: 'amd', clean: true},
    plugins: [new CopyPlugin({patterns: [{from: 'src/plugin.json'}, {from: 'src/img', to: 'img'}, {from: 'README.md'}, {from: 'docs', to: 'docs'}]})],
  },
  {
    ...shared,
    name: 'dashboard-app',
    entry: './app/src/module.tsx',
    output: {path: path.resolve(__dirname, 'dist/dataspacelab-dil-dashboard-app'), filename: 'module.js', libraryTarget: 'amd', clean: true},
    plugins: [new CopyPlugin({patterns: [{from: 'app/src/plugin.json'}, {from: 'src/img', to: 'img'}, {from: 'app/README.md'}]})],
  },
];
