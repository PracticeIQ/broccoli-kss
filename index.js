var Writer = require('broccoli-writer');
var RSVP = require('rsvp');
var path = require('path');
var mkdirp = require('mkdirp');

module.exports = KssCompiler;
KssCompiler.prototype = Object.create(Writer.prototype);
KssCompiler.prototype.constructor = KssCompiler;

function KssCompiler(sourceTree, options) {
  if (!(this instanceof KssCompiler)) return new KssCompiler(sourceTree, options);
  this.sourceTree = sourceTree;
  this.options = options || {};
};

KssCompiler.prototype.write = function(readTree, destDir) {
  var self = this
  return new RSVP.Promise(function(resolve, reject){
    return readTree(self.sourceTree).then(function(srcDir) {
      var kssDir = destDir + '/' + (self.options.destDir || '');
      mkdirp.sync(path.dirname(kssDir));
      self.compile(srcDir, kssDir, self.options.sassFile, self.options.templateDir, resolve, reject);

    }, function(e){
      console.error('Error for .write', e)
    });
  });
};

KssCompiler.prototype.compile = function(sourceDir, destDir, sassFile, templateDir, resolve, reject) {
  var kss = require('kss'),
    preCompiler = kss.precompilers,
    handlebars = require('handlebars'),
    cleanCss = require('clean-css'),
    optimist = require('optimist'),
    marked = require('marked'),
    wrench = require('wrench'),
    stylus = require('stylus'),
    async = require('async'),
    util = require('util'),
    less = require('less'),
    fs = require('fs'),
    template, styleguide,
    generatePage, generateStylesheet,
    options = {
      templateDirectory: templateDir,
      sourceDirectory: sourceDir,
      destinationDirectory: destDir
    },
    KSS_FAILED = false,
    argv;

  // Compile the Handlebars template
  // What's this template for?
  template = fs.readFileSync(options.templateDirectory + '/index.html', 'utf8');
  template = handlebars.compile(template);
  // Create a new "styleguide" directory and copy the contents
  // of "public" over.
  try {
    fs.mkdirSync(options.destinationDirectory);

    mkdirp.sync('app/templates/catalogue');

  } catch (e) {
    console.log('Tried to make a styleguide directory', e);
  }

  console.log('copy dirs', options.templateDirectory + '/public',  options.destinationDirectory + '/public' );

  // you need a public directory in the kss/templates folder
  wrench.copyDirSyncRecursive(
    options.templateDirectory + '/public',
    options.destinationDirectory + '/public'
  );

  // Generate the static HTML pages in the next tick, i.e. after the other functions have
  // been defined and handlebars helpers set up.
  process.nextTick(function() {
    console.log('\n...compiling KSS styles');
    less.render('@import "' + path.relative(process.cwd(), options.destinationDirectory) + '/public/kss.less";', function(err, css) {
      if (err) {
        console.error(err);
        reject(err)
      }

      css = cleanCss.process(css);

      // Write the compiled LESS styles from the template.
      fs.writeFileSync(options.destinationDirectory + '/public/kss.css', css, 'utf8');

      // console.log('precompiler', preCompiler)
      console.log('...parsing your styleguide', options.sourceDirectory);
      kss.traverse(options.sourceDirectory, {
        multiline: true,
        markdown: false,
        markup: true,
        // mask: '*.scss'
      }, function(err, sg) {
        if (err) {
          console.log(err);
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

        // console.log(sg.data.files.map(function(file) {
        //   return ' - ' + file
        // }).join('\n'))


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


        // Now, group all of the sections by their root
        // reference, and make a page for each.
        for (i = 0; i < rootCount; i += 1) {
          childSections = styleguide.section(sectionRoots[i] + '.*');
          // Run process cmd here
          generatePage(
            styleguide, childSections,
            sectionRoots[i], pages, sectionRoots
          );
        }

        generateIndex(styleguide, childSections, pages, sectionRoots);
        resolve();
      });
    });
  });

  

  // Renders the handlebars template for a section and saves it to a file.
  // Needs refactoring for clarity.
  generatePage = function(styleguide, sections, root, pages, sectionRoots) {
    console.log(
      '...generating section ' + root + ' [',
      styleguide.section(root) ? styleguide.section(root).header() : 'Unnamed',
      ']'
    );

    try{

// files are not getting overwritten
    fs.writeFileSync('app/templates/catalogue'+ '/section-' + root + '.hbs',
      template({
        styleguide: styleguide,
        sections: jsonSections(sections),
        rootNumber: root,
        sectionRoots: sectionRoots,
        overview: false,
        argv: argv || {}
      })
    );
  }catch(e) {
    console.error(e)
  }
  };

  // Equivalent to generatePage, however will take `styleguide.md` and render it
  // using first Markdown and then Handlebars
  generateIndex = function(styleguide, sections, pages, sectionRoots) {
    try {
      console.log('...generating styleguide overview');
      fs.writeFileSync('app/templates/catalogue/index.hbs',
        template({
          styleguide: styleguide,
          sectionRoots: sectionRoots,
          sections: jsonSections(sections),
          rootNumber: 0,
          argv: argv || {},
          overview: marked(fs.readFileSync('app/styles/styleguide.md', 'utf8'))
        })
      );
    } catch (e) {
      console.log('...no styleguide overview generated:', e.message);
    }
  };

  // Convert an array of `KssSection` instances to a JSON object.
  jsonSections = function(sections) {
    return sections.map(function(section) {

      return {
        header: section.header(),
        description: section.description(),
        reference: section.reference(),
        // linkTo: '{{link-to '+ JSON.stringify(section.reference())+'}}',
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

  handlebars.registerHelper('linkTo', function(options){
    if(!options && !options.hash) return '';
    var reference = options.hash.name || '';
    var label = options.hash.label;
    return '{{#link-to catalogue/section-'+reference+'}}'+label+'{{/link-to}}';
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
    // console.log('modifier', section.data);
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