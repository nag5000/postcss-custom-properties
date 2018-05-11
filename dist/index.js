"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _postcss = require("postcss");

var _postcss2 = _interopRequireDefault(_postcss);

var _balancedMatch = require("balanced-match");

var _balancedMatch2 = _interopRequireDefault(_balancedMatch);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var VAR_PROP_IDENTIFIER = "--";
var VAR_FUNC_IDENTIFIER = "var";
var VAR_FUNC_REGEX = /(^|[^\w-])var\(/;
// matches `name[, fallback]`, captures "name" and "fallback"
var RE_VAR = /[\f\n\r\t ]*([\w-]+)(?:[\f\n\r\t ]*,[\f\n\r\t ]*([\W\w]+))?/;

/**
 * Module variables
 */

var globalOpts = void 0;

/**
 * Resolve CSS variables.
 *
 * The second argument to the CSS variable function, var(name[, fallback]),
 * is used in the event that first argument cannot be resolved.
 *
 * @param {String} value May contain the CSS variable function
 * @param {Object} variables A map of variable names and values
 * @param {Object} result The PostCSS result object
 * @param {Object} decl The declaration containing the rule
 * @return {String} A property value with all CSS variables substituted.
 */
function resolveValue(value, variables, result, decl) {
  var results = [];

  var hasVarFunction = VAR_FUNC_REGEX.test(value);

  if (!hasVarFunction) {
    return [value];
  }

  var match = value.match(VAR_FUNC_REGEX);
  var start = match.index + match[1].length;

  var matches = (0, _balancedMatch2.default)("(", ")", value.substring(start));

  if (!matches) {
    throw decl.error(`missing closing ')' in the value '${value}'`);
  }

  if (matches.body === "") {
    throw decl.error("var() must contain a non-whitespace string");
  }

  matches.body.replace(RE_VAR, function (_, name, fallback) {
    var variable = variables[name];
    var post = void 0;
    // undefined and without fallback, just keep original value
    if (!variable && !fallback) {
      assert("no-value-notifications", false, `variable '${name}' is undefined and used without a fallback`, { decl, result, word: name });

      post = matches.post ? resolveValue(matches.post, variables, result, decl) : [""];
      // resolve the end of the expression
      post.forEach(function (afterValue) {
        results.push(value.slice(0, start) + VAR_FUNC_IDENTIFIER + "(" + name + ")" + afterValue);
      });
      return;
    }

    // prepend with fallbacks
    if (fallback) {
      // resolve fallback values
      fallback = resolveValue(fallback, variables, result, decl);
      // resolve the end of the expression before the rest
      post = matches.post ? resolveValue(matches.post, variables, result, decl) : [""];
      fallback.forEach(function (fbValue) {
        post.forEach(function (afterValue) {
          results.push(value.slice(0, start) + fbValue + afterValue);
        });
      });
    }

    if (!variable) {
      return;
    }

    // replace with computed custom properties
    if (!variable.resolved) {
      // circular reference encountered
      if (variable.deps.indexOf(name) !== -1) {
        if (!fallback) {
          assert("circular-reference", false, `Circular variable reference: ${name}`, { decl, result, word: name });

          variable.value = [variable.value];
          variable.circular = true;
        } else {
          variable.value = fallback;
          return;
        }
      } else {
        variable.deps.push(name);
        variable.value = resolveValue(variable.value, variables, result, decl);
      }
      variable.resolved = true;
    }
    if (variable.circular && fallback) {
      return;
    }
    // resolve the end of the expression
    post = matches.post ? resolveValue(matches.post, variables, result, decl) : [""];
    variable.value.forEach(function (replacementValue) {
      post.forEach(function (afterValue) {
        results.push(value.slice(0, start) + replacementValue + afterValue);
      });
    });
  });

  return results;
}

function prefixVariables(variables) {
  var prefixedVariables = {};

  if (!variables) {
    return prefixedVariables;
  }

  Object.keys(variables).forEach(function (name) {
    var val = variables[name];
    if (name.slice(0, 2) !== "--") {
      name = "--" + name;
    }
    prefixedVariables[name] = String(val);
  });

  return prefixedVariables;
}

/**
 * Define an assertion that will print a warning or throw an exception
 * if the condition is not met.
 *
 * @param {String} ruleName Name of the rule in `options.warnings`.
 * @param {Boolean} condition Must be truthy for the assertion to pass.
 * @param {String} message Text of the warning or error if the assertion fails.
 * @param {Object} context PostCSS context objects: decl, result and
 *                         warning (error) options.
 */
function assert(ruleName, condition, message, _ref) {
  var decl = _ref.decl,
      result = _ref.result,
      word = _ref.word,
      index = _ref.index,
      plugin = _ref.plugin;

  if (condition || !globalOpts.warnings) {
    return;
  }

  if (globalOpts.warnings === true || globalOpts.warnings[ruleName] === true) {
    result.warn(message, { node: decl, word, index, plugin });
  } else if (globalOpts.warnings[ruleName] === "error") {
    decl = decl || result.root.first;
    throw decl.error(message, { word, index, plugin });
  }
}

/**
 * Module export.
 */
exports.default = _postcss2.default.plugin("postcss-custom-properties", function () {
  var options = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};


  function setVariables(variables) {
    options.variables = prefixVariables(variables);
  }

  function plugin(style, result) {
    var variables = prefixVariables(options.variables);
    var strict = "strict" in options ? Boolean(options.strict) : true;
    var appendVariables = "appendVariables" in options ? Boolean(options.appendVariables) : false;
    var preserve = "preserve" in options ? options.preserve : true;
    var map = {};
    var importantMap = {};

    globalOpts = {
      warnings: options.warnings
    };

    if ("noValueNotifications" in options) {
      result.warn("'noValueNotifications' is deprecated. Use " + "\"options.warnings['no-value-notifications']: true|false|'error'\"" + "instead.");

      if (typeof globalOpts.warnings === "object") {
        globalOpts.warnings["no-value-notifications"] = options.noValueNotifications === "error" ? "error" : true;
      } else if (globalOpts.warnings === true && options.noValueNotifications === "error") {
        globalOpts.warnings = {
          "no-value-notifications": "error",
          "not-scoped-to-root": true,
          "circular-reference": true
        };
      }
    }

    // define variables
    style.walkRules(function (rule) {
      var toRemove = [];

      // only variables declared for `:root` are supported for now
      if (rule.selectors.length !== 1 || rule.selectors[0] !== ":root" || rule.parent.type !== "root") {
        rule.each(function (decl) {
          var prop = decl.prop;
          assert("not-scoped-to-root", !prop || prop.indexOf(VAR_PROP_IDENTIFIER) !== 0, "Custom property ignored: not scoped to the top-level :root " + `element (${rule.selectors} { ... ${prop}: ... })` + (rule.parent.type !== "root" ? ", in " + rule.parent.type : ""), { decl, result });
        });
        return;
      }

      rule.each(function (decl, index) {
        var prop = decl.prop;
        if (prop && prop.indexOf(VAR_PROP_IDENTIFIER) === 0) {
          if (!map[prop] || !importantMap[prop] || decl.important) {
            map[prop] = {
              value: decl.value,
              deps: [],
              circular: false,
              resolved: false
            };
            importantMap[prop] = decl.important;
          }
          toRemove.push(index);
        }
      });

      // optionally remove `--*` properties from the rule
      if (!preserve) {
        for (var i = toRemove.length - 1; i >= 0; i--) {
          rule.nodes.splice(toRemove[i], 1);
        }

        // remove empty :root {}
        if (rule.nodes.length === 0) {
          rule.remove();
        }
      }
    });

    // apply js-defined custom properties
    Object.keys(variables).forEach(function (variable) {
      map[variable] = {
        value: variables[variable],
        deps: [],
        circular: false,
        resolved: false
      };
    });

    if (preserve) {
      Object.keys(map).forEach(function (name) {
        var variable = map[name];
        if (!variable.resolved) {
          variable.value = resolveValue(variable.value, map, result);
          variable.resolved = true;
        }
      });
    }

    // resolve variables
    style.walkDecls(function (decl) {
      var value = decl.raws.value ? decl.raws.value.raw : decl.value;

      // skip values that don’t contain variable functions
      if (!value || value.indexOf(VAR_FUNC_IDENTIFIER + "(") === -1) {
        return;
      }

      var resolved = resolveValue(value, map, result, decl);
      if (!strict) {
        resolved = [resolved.pop()];
      }
      resolved.forEach(function (resolvedValue) {
        var clone = decl.cloneBefore();
        clone.value = resolvedValue;
      });

      if (!preserve || preserve === "computed") {
        decl.remove();
      }
    });

    if (preserve && appendVariables) {
      var names = Object.keys(map);
      if (names.length) {
        var container = _postcss2.default.rule({
          selector: ":root",
          raws: { semicolon: true }
        });
        names.forEach(function (name) {
          var variable = map[name];
          var val = variable.value;
          if (variable.resolved) {
            val = val[val.length - 1];
          }
          var decl = _postcss2.default.decl({
            prop: name,
            value: val
          });
          container.append(decl);
        });
        style.append(container);
      }
    }
  }

  plugin.setVariables = setVariables;

  return plugin;
});
module.exports = exports["default"];