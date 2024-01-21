/**
 * Build our custom version of Bootstrap CSS.
 * This also copies the JS files of the current bootstrap file into where we want them.
 */

const sass = require('sass');
const path = require('node:path');
const fs = require('node:fs/promises');
const autoprefixer = require('autoprefixer');
const postcss = require('postcss');

const SRC = path.join('assets', 'bootstrap.scss');
const DEST = path.join('assets', 'lib');
const FILE_NAME = 'bootstrap.custom.css';

sass
  .compileAsync(path.join(__dirname, '..', SRC), {
    style: 'compressed',
    sourceMap: true,
    sourceMapIncludeSources: true,
    loadPaths: [path.join(__dirname, '..', 'node_modules')]
  })
  .then((result) => {
    return postcss([autoprefixer]).process(result.css, {
      from: SRC,
      map: {
        inline: false
      },
      to: path.join(DEST, FILE_NAME)
    });
  })
  .then((result) => {
    result.warnings().forEach((warn) => {
      console.warn(warn.toString());
    });

    return result;
  })
  .then((result) => {
    let files = [];
    files.push(fs.writeFile(path.join(DEST, FILE_NAME), result.css));
    files.push(fs.writeFile(path.join(DEST, FILE_NAME) + '.map', result.map.toString()));

    // Copy JS to assets lib path
    const jsPath = path.join(__dirname, '..', 'node_modules', 'bootstrap', 'dist', 'js');
    files.push(
      fs.copyFile(
        path.join(jsPath, 'bootstrap.bundle.min.js'),
        path.join(DEST, 'bootstrap.bundle.min.js')
      )
    );

    files.push(
      fs.copyFile(
        path.join(jsPath, 'bootstrap.bundle.min.js.map'),
        path.join(DEST, 'bootstrap.bundle.min.js.map')
      )
    );

    return Promise.all(files);
  })
  .then((result) => {
    console.log('Bootstrap built to: ' + DEST);
  })
  .catch((error) => {
    console.error(error);
  });

