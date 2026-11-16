// Lets Metro bundle the shared package (the top-level shared/ folder) that lives outside this app folder.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../../shared');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [sharedRoot];
config.resolver.extraNodeModules = { '@diu/shared': sharedRoot };
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

module.exports = config;
