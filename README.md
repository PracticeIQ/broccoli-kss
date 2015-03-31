#broccol-kss generator

This is a fork of [broccoli-kss](https://github.com/habdelra/broccoli-kss) based on [kss-node](https://github.com/hughsk/kss-node) that generates a styleguide in your app tree

For the build to succeed, you need to have in your project a single markdown file which provides an overview of your styleguide, kss.js, and a base template to generate the styleguide pages from

e.g.

```
/vendor/catalogue
  /vendor/catalogue/catalogue.md
  /vendor/catalogue/index.html
  /vendor/kss.js
```

In your Brocfile.js
```javascript
// Require the broccoli dependencies
var pickFiles = require('broccoli-static-compiler');
var compileKss = require('broccoli-kss');
var mergeTrees = require('broccoli-merge-trees');

var kssSource = pickFiles('app', {
// The styles directory which KSS will look in
srcDir: 'styles',
//  The tree needs this property but it can be empty
destDir: ''
});

var styleguide = compileKss(kssSource, {
// Specify where the base template sits (index.html)
indexDir: 'vendor/catalogue',
// Where the templates should be generated
templateOutputDir: 'app/templates/catalogue',
// Where the routes should be generated
routeOutputDir: 'app/routes/catalogue',
// This needs to be here because of a bug with /tmp - See https://github.com/habdelra/broccoli-kss/issues/1
destDir: 'catalogue',
});

mergeTrees([app.toTree(), styleguide]);

```
