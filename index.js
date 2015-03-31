var Writer = require('broccoli-writer');
var RSVP = require('rsvp');
var path = require('path');
var mkdirp = require('mkdirp');
var shell = require('shelljs/global');
var async = require('async');
var rimraf = require('rimraf');
var RouterGenerator = require("ember-router-generator");
var kss = require('kss');
var handlebars = require('handlebars');
var optimist = require('optimist');
var marked = require('marked');
var async = require('async');
var fs = require('fs');
var c = require('colors');


module.exports = KssCompiler;
KssCompiler.prototype = Object.create(Writer.prototype);
KssCompiler.prototype.constructor = KssCompiler;

/**
 * KSSCompiler
 * @constructor
 * @desc The constructor for the KSS compiler
 * @param {Object} sourceTree A Broccoli file tree
 * @param {Object} options    Build options
 */
function KssCompiler(sourceTree, options) {
  if (!(this instanceof KssCompiler)) return new KssCompiler(sourceTree, options);
  this.sourceTree = sourceTree;
  this.options = options || {};
};

/**
 * write
 * @desc Returns a promise to generate catalogue templates
 */
KssCompiler.prototype.write = function(readTree) {
  var self = this
  return new RSVP.Promise(function(resolve, reject) {
    return readTree(self.sourceTree).then(function(srcDir) {
      console.log(self.options);
      self.compile(srcDir, self.options.indexDir, self.options.templateOutputDir, self.options.routeOutputDir, resolve, reject);
    }, function(e) {
      console.error(c.red('Error for .write', e))
    });
  });
};


KssCompiler.prototype.compile = function(sourceDir, indexDir, templateOutput, routeOutput, resolve, reject) {

  console.log('');
  console.log(c.green('Starting the catalogue generator'));

  var template, styleguide,
    generatePage, generateStylesheet,
    options = {
      indexDirectory: indexDir,
      sourceDirectory: sourceDir,
      'templatesDir': templateOutput,
      'routesDir': routeOutput
    },
    KSS_FAILED = false,
    argv;

  console.log(c.bgGreen('Compiling'), c.green('the base index.html template from ' + options.indexDirectory));

  template = fs.readFileSync(options.indexDirectory + '/index.html', 'utf8');
  template = handlebars.compile(template);


  process.nextTick(function() {

    kss.traverse(options.sourceDirectory, {
      multiline: true,
      markdown: false,
      markup: true
    }, function(err, sg) {
      if (err) {
        console.error(c.bgRed('Error parsing styles with kss ' + err));
        reject(err);
        throw err
      }

      styleguide = sg;

      var sections = styleguide.section(),
        i, sectionCount = sections.length,
        sectionRoots = [],
        currentRoot,
        rootCount, childSections = [],
        pages = {};

      // Accumulate all of the sections' first indexes
      // in case they don't have a root element.
      for (i = 0; i < sectionCount; i += 1) {
        currentRoot = sections[i].reference().match(/[0-9]*\.?/)[0].replace('.', '');
        if (!~sectionRoots.indexOf(currentRoot)) {
          sectionRoots.push(currentRoot);
        }
      }

      sectionRoots.sort();
      rootCount = sectionRoots.length;

      // Make sure the routes and templates directories exist
      mkdirp.sync(options.templatesDir);
      mkdirp.sync(options.routesDir);

      for (i = 0; i < rootCount; i += 1) {
        childSections = styleguide.section(sectionRoots[i] + '.*');


        // Add the route files to the router map
        addRouteToMap(process.cwd(), {
          entity: {
            name: 'catalogue/section' + sectionRoots[i]
          }
        });

        // Generate the template files
        generatePage(
          styleguide, childSections,
          sectionRoots[i], pages, sectionRoots
        );
      }

      // Generate the main index file based on styleguide.md
      generateIndex(styleguide, childSections, pages, sectionRoots);
      resolve();
    });
  });


  // Generate an 'empty' route file for each catalogue page
  generateRouteFile = function(routerFilePath) {
    var newContents = "import Ember from \"ember\";\nexport default Ember.Route.extend({});";
    console.log(c.blue('Generated route [', routerFilePath + '.js ]'));

    fs.writeFileSync(routerFilePath + '.js', newContents);
  }

  // Add the route to the app's router-map
  addRouteToMap = function(target, options) {
    var routerFilePath = path.join(target, "addon", "router-map.js");
    var routerFileContents = fs.readFileSync(routerFilePath, "utf-8");
    generateRouteFile('app/routes/' + options.entity.name);
    var routes = new RouterGenerator(routerFileContents);
    var newRouterContents = routes.add(options.entity.name).code();
    fs.writeFileSync(routerFilePath, newRouterContents);
  }

  // Renders the handlebars template for a section and saves it to a file.
  // Needs refactoring for clarity.
  generatePage = function(styleguide, sections, root, pages, sectionRoots) {
    console.log(c.green('Generated template ' + root + ' [',
      styleguide.section(root) ? styleguide.section(root).header() : 'Unnamed',
      ']'));

    try {
      fs.writeFileSync(options.templatesDir + '/section' + root + '.hbs',
        template({
          styleguide: styleguide,
          sections: jsonSections(sections),
          rootNumber: root,
          sectionRoots: sectionRoots,
          overview: false,
          argv: argv || {}
        })
      );
    } catch (e) {
      console.error(c.bgRed('Error generating page'), c.red(e));
    }
  };

  // Equivalent to generatePage, however will take `catalogue.md` and render it
  // using first Markdown and then Handlebars
  generateIndex = function(styleguide, sections, pages, sectionRoots) {
    try {
      console.log(c.green('Generated overview at [ ' + options.templatesDir + ' /index.hbs ]'));
      fs.writeFileSync(options.templatesDir + '/index.hbs',
        template({
          styleguide: styleguide,
          sectionRoots: sectionRoots,
          sections: jsonSections(sections),
          rootNumber: 0,
          argv: argv || {},
          overview: marked(fs.readFileSync(options.indexDirectory + '/catalogue.md', 'utf8'))
        })
      );
    } catch (e) {
      console.error(c.bgRed('Error generating overview file'), c.red(e));
    }
  };

  // Convert an array of `KssSection` instances to a JSON object.
  jsonSections = function(sections) {
    return sections.map(function(section) {

      return {
        header: section.header(),
        description: section.description(),
        reference: section.reference(),
        depth: section.data.refDepth,
        deprecated: section.deprecated(),
        experimental: section.experimental(),
        modifiers: jsonModifiers(section.modifiers())
      };
    });
  };

  // Convert an array of `KssModifier` instances to a JSON object.
  jsonModifiers = function(modifiers) {
    return modifiers.map(function(modifier) {
      return {
        name: modifier.name(),
        description: modifier.description(),
        className: modifier.className()
      };
    });
  };

  /**
   * Equivalent to the {#if} block helper with multiple arguments.
   */
  handlebars.registerHelper('ifAny', function() {
    var argLength = arguments.length - 2,
      content = arguments[argLength + 1],
      success = true;

    for (var i = 0; i < argLength; i += 1) {
      if (!arguments[i]) {
        success = false;
        break;
      }
    }

    return success ? content(this) : content.inverse(this);
  });

  handlebars.registerHelper('linkTo', function(options) {
    if (!options && !options.hash) return '';
    var reference = options.hash.name || '';
    var label = options.hash.label;
    return '{{#link-to catalogue/section' + reference + '}}' + label + '{{/link-to}}';
  })

  /**
   * Returns a single section, found by its reference number
   * @param  {String|Number} reference The reference number to search for.
   */
  handlebars.registerHelper('section', function(reference) {
    var section = styleguide.section(reference);
    if (!section) return false;

    return arguments[arguments.length - 1](section.data);
  });

  /**
   * Loop over a section query. If a number is supplied, will convert into
   * a query for all children and descendants of that reference.
   * @param  {Mixed} query The section query
   */
  handlebars.registerHelper('eachSection', function(query) {
    var sections,
      i, l, buffer = "";

    if (!query.match(/x|\*/g)) {
      query = new RegExp('^' + query + '$|^' + query + "\\..*");
    }
    sections = styleguide.section(query);
    if (!sections) return '';

    l = sections.length;
    for (i = 0; i < l; i += 1) {
      buffer += arguments[arguments.length - 1](sections[i].data);
    }

    return buffer;
  });

  /**
   * Loop over each section root, i.e. each section only one level deep.
   */
  handlebars.registerHelper('eachRoot', function() {
    var sections,
      i, l, buffer = "";

    sections = styleguide.section('x');
    if (!sections) return '';

    l = sections.length;
    for (i = 0; i < l; i += 1) {
      buffer += arguments[arguments.length - 1](sections[i].data);
    }

    return buffer;
  });

  /**
   * Equivalent to "if the current section is X levels deep". e.g:
   *
   * {{#refDepth 1}}
   *   ROOT ELEMENTS ONLY
   *  {{else}}
   *   ANYTHING ELSE
   * {{/refDepth}}
   */
  handlebars.registerHelper('whenDepth', function(depth, context) {
    if (!(context && this.refDepth)) {
      return '';
    }
    if (depth == this.refDepth) {
      return context(this);
    }
    if (context.inverse) {
      return context.inverse(this);
    }
  });

  /**
   * Similar to the {#eachSection} helper, however will loop over each modifier
   * @param  {Object} section Supply a section object to loop over it's modifiers. Defaults to the current section.
   */
  handlebars.registerHelper('eachModifier', function(section) {
    var modifiers, i, l, buffer = '';

    // Default to current modifiers, but allow supplying a custom section
    if (section.data) modifiers = section.data.modifiers;
    modifiers = modifiers || this.modifiers || false;

    if (!modifiers) return {};

    l = modifiers.length;
    for (i = 0; i < l; i++) {
      buffer += arguments[arguments.length - 1](modifiers[i].data || '');
    }
    return buffer;
  });

  /**
   * Outputs a modifier's markup, if possible.
   * @param  {Object} modifier Specify a particular modifier object. Defaults to the current modifier.
   */
  handlebars.registerHelper('modifierMarkup', function(modifier) {
    modifier = arguments.length < 2 ? this : modifier || this || false;

    if (!modifier) {
      return false;
    }

    // Maybe it's actually a section?
    if (modifier.modifiers) {
      return new handlebars.SafeString(
        modifier.markup
      );
    }

    // Otherwise return the modifier markup
    // Markup is not set correctly because thismethod returns false
    var kssMod = new kss.KssModifier(modifier);
    var className = kssMod.className();
    var markup = kssMod.markup();
    // Added replace statement manually
    markup = markup.replace(/\{\$modifiers\}/g, className);
    return new handlebars.SafeString(
      markup
    );
  });

  /**
   * Quickly avoid escaping strings
   * @param  {String} arg The unescaped HTML
   */
  handlebars.registerHelper('html', function(arg) {
    return new handlebars.SafeString(arg || '');
  });


  /**
   * Enable rendering raw handlebars in a hbs template
   */
  handlebars.registerHelper('raw', function(arg) {
    var left = new RegExp('{', 'g');
    var right = new RegExp('}', 'g');
    arg = arg.replace(left, '&#123;');
    arg = arg.replace(right, '&#125;')
    return arg;
  });

  // not being removed after
  process.on('exit', function() {
    if (!KSS_FAILED) {
      console.log('');
      console.log('Generation completed successfully!');
      console.log('');
    }
  });

  process.on('uncaughtException', function(err) {
    console.log(err.message);
    console.log(err.stack);
    KSS_FAILED = true;
    process.exit(1);
  })
};
