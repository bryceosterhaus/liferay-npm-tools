const glob = require('glob');
const path = require('path');
const which = require('npm-which')(process.cwd());
const spawnSync = require('../utils/spawnSync');
const getMergedConfig = require('../utils/get-merged-config');
const generateSoyDependencies = require('../utils/generate-soy-dependencies');

const BUILD_CONFIG = getMergedConfig('npmscripts').build;

/**
 * Removes any generated soy.js files
 */
exports.cleanSoy = function() {
	spawnSync(which.sync('rimraf'), ['src/**/*.soy.js',]);
};

/**
 * Compiles soy files by running `metalsoy` bin with specified soy dependencies
 */
exports.buildSoy = function() {
	spawnSync(which.sync('metalsoy'), [
		'--soyDeps',
		generateSoyDependencies(BUILD_CONFIG.dependencies),
	]);
};

/**
 * Checks to see if there are any soy files
 */
exports.soyExists = function() {
	return !!glob.sync(path.join(BUILD_CONFIG.input, '/**/*.soy')).length;
};