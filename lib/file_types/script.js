/*jshint node:true */
/*globals BT*/

sc_require('../mixins/traceur');

BT.ScriptFile = BT.File.extend(BT.TraceurMixin, {
  extension: "js",
  isScript: true,
  isTest: function () {
    // a test is a script, which isn't a normal script. The relative path of a test file to its framework starts with tests
    // Not doing this with regex on the complete path, as that disabled using an app called tests
    var relp = this.get('relativePath');
    var test_i = relp.indexOf("tests");
    if (test_i === 0 || test_i === 1) { // for tests/ or /tests
      return true;
    }
    else return false;
  }.property('path').cacheable(),

  shouldMinify: false,
  order: null, // this is where the framework will store the order of this file
  contentType: 'application/javascript',

  _replaceScSuper: function (str) {
    if (/sc_super\(\s*[^\)\s]+\s*\)/.test(str)) {
      BT.Logger.error("ERROR in %@:  sc_super() should not be called with arguments. Modify the arguments array instead.".fmt(this.get('path')));
    }
    if (str && str.replace) {
      return str.replace(/sc_super\(\)/g, 'arguments.callee.base.apply(this,arguments)');
    }
  },

  minify: function (str) {
    var ret;
    try {
      if (BT.runBenchmarks) SC.Benchmark.start('scriptFile:minify');
      ret = require('uglify-js').minify(str, { fromString: true }).code;
      if (BT.runBenchmarks) SC.Benchmark.end('scriptFile:minify');
    }
    catch (e) {
      SC.Logger.error("Error while minifying the script file '%@': %@".fmt(this.get('path'), e.message));
      throw e;
    }
    return ret;
  },

  /**
    Handle `//@if(debug|build) ... //@endif` comments

    @private
  */
  handleRunModeComments: function (src) {
    var startregex;

    switch(BT.runMode) {
      case BT.RM_DEBUG: 
        startregex = /@if\s?\(build\)/;
      break;
      case BT.RM_BUILD: 
        startregex = /@if\s?\(debug\)/;
      break;
    }

    //var endregex = /@endif/;
    var lines = src.split("\n"), ret = [];
    var insideIfDebug;
    lines.forEach(function (line) {
      if (line.search(startregex) > -1) {
        insideIfDebug = true;
      }
      if (!insideIfDebug) ret.push(line);
      if (insideIfDebug) {
        if (line.indexOf("@end") > -1) insideIfDebug = false; // catches both @end and @endif
      }
    });
    return ret.join("\n");
  },

  dependencies: function () {
    // find dependencies
    var c = this.get('content');
    var ext = "." + this.get('extension');
    var fwpath = this.getPath('framework.path');
    var pathlib = require('path');
    var abspath, relpath, match;
    var ret = [];
    var re = new RegExp("sc_require\\([\"'](.*?)[\"']\\)", "g");
    while (match = re.exec(c)) {
      relpath = match[1];
      relpath = (relpath.lastIndexOf(ext) === -1) ? relpath + ext : relpath;
      //depFilename = BT.path.join(BT.projectPath, me.get('path'), relpath);
      // //currentFile.after(depFilename); // will automatically do the reverse lookup
      abspath = pathlib.join(fwpath, relpath);
      if (!ret.contains(abspath)) ret.push(abspath);
    }
    return ret;
  }.property('content').cacheable(),

  parseContent: function (opts) {

    // replace sc_super()
    var raw = this.get('rawContent');
    if (!raw) {
      //BT.Logger.warn("how can a known file have no rawContent?? " + this.get('path'));
      // very simple: either empty, or about to be deleted from the system
      return "";
    }
    var str = raw.toString(); // rawContent is a buffer, scriptfile always a string
    if (!str) return "";
    // let handleRunModeComments decide whether to do anything, in case it has to be extended somehow
    if (BT.runBenchmarks) SC.Benchmark.start('scriptFile:handleRunModeComments');
    str = this.handleRunModeComments(str);
    if (BT.runBenchmarks) SC.Benchmark.end('scriptFile:handleRunModeComments');

    if (BT.runBenchmarks) SC.Benchmark.start('scriptFile:sc_super');
    str = this._replaceScSuper(str);
    if (BT.runBenchmarks) SC.Benchmark.end('scriptFile:sc_super');

    // Note: Traceur compiler will remove the comments, which means that handleRunModeComments must
    // be call before and sc_require must be commented after.
    if (BT.runBenchmarks) SC.Benchmark.start('scriptFile:traceurCompilation');
    str = this.handleTraceur(str);
    if (BT.runBenchmarks) SC.Benchmark.end('scriptFile:traceurCompilation');

    if (BT.runBenchmarks) SC.Benchmark.start('scriptFile:static_url');
    str = this.handleStatic(str, opts);
    if (BT.runBenchmarks) SC.Benchmark.end('scriptFile:static_url');

    if (this.get('isTest')) {
      var testCode = 'if (typeof SC !== "undefined") {\n  SC.mode = "TEST_MODE";\n';
      testCode += 'SC.filename = "%@"; \n}\n(function() {\n'.fmt(this.get('url'));
      testCode += str;
      testCode += "\n})();\n";
      str = testCode;
    }
    else {
      str = str.replace(/(sc_require\([\"'].*?[\"']\)[,;]?)/g, "//$1");
      if (this.get('shouldMinify')) {
        str = this.minify(str);
      }
    }
    return str;
  }
});