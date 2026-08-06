/**
 * Rules-of-Hooks checker built on the TypeScript compiler API (no new deps).
 *
 * Catches the two violations that actually break React at runtime:
 *   A. a hook called AFTER a conditional early return  → "rendered fewer hooks
 *      than expected" (React #300) on the render where the return fires;
 *   B. a hook called inside a condition / loop / logical operator.
 *
 * This is the exact class of bug that blanked the app on every fresh install.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const REPO = path.resolve(__dirname, "..");
const ROOTS = [path.join(REPO, "apps", "web", "src")];

function walkFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const isHookName = (n) => /^use[A-Z]/.test(n);

/** Name of the function being called, for `useState(...)` / `React.useState(...)`. */
function calleeName(node) {
  if (!ts.isCallExpression(node)) return null;
  const e = node.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) return e.name.text;
  return null;
}

/** Component or custom hook? (PascalCase function, or useXxx) */
function isReactFunction(name) {
  return !!name && (/^[A-Z]/.test(name) || isHookName(name));
}

function functionName(node) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  // const Foo = () => {} / function Foo(){}
  const p = node.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  return null;
}

const findings = [];

for (const root of ROOTS) {
  for (const file of walkFiles(root)) {
    const src = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    const at = (pos) => src.getLineAndCharacterOfPosition(pos).line + 1;

    /** Analyse one component/hook function body, ignoring nested functions. */
    function analyse(fn, name) {
      const body = fn.body;
      if (!body || !ts.isBlock(body)) return;

      const returns = [];  // conditional/early returns
      const hooks = [];    // hook calls
      const condHooks = [];

      // depth of conditional constructs we are currently inside
      const visit = (node, condDepth) => {
        // do not descend into nested function bodies — they have their own scope
        if (node !== fn && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))) return;

        if (ts.isReturnStatement(node)) {
          const isLastTopLevel = body.statements.length && body.statements[body.statements.length - 1] === node;
          if (!isLastTopLevel) returns.push(node.getStart());
        }

        const cn = calleeName(node);
        if (cn && isHookName(cn)) {
          hooks.push({ name: cn, pos: node.getStart() });
          if (condDepth > 0) condHooks.push({ name: cn, pos: node.getStart() });
        }

        let nextDepth = condDepth;
        if (
          ts.isIfStatement(node) || ts.isConditionalExpression(node) ||
          ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) ||
          ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isSwitchStatement(node) ||
          ts.isCatchClause(node) ||
          (ts.isBinaryExpression(node) &&
            (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
             node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
             node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken))
        ) nextDepth = condDepth + 1;

        // the if-condition itself is not conditional; only its branches are
        if (ts.isIfStatement(node)) {
          visit(node.expression, condDepth);
          if (node.thenStatement) visit(node.thenStatement, condDepth + 1);
          if (node.elseStatement) visit(node.elseStatement, condDepth + 1);
          return;
        }

        node.forEachChild((c) => visit(c, nextDepth));
      };
      fn.body.forEachChild((c) => visit(c, 0));

      if (returns.length) {
        const firstReturn = Math.min(...returns);
        for (const h of hooks) {
          if (h.pos > firstReturn) {
            findings.push({
              kind: "HOOK_AFTER_EARLY_RETURN",
              file, fn: name, hook: h.name,
              hookLine: at(h.pos), returnLine: at(firstReturn),
            });
            break; // one report per function is enough
          }
        }
      }
      for (const h of condHooks) {
        findings.push({
          kind: "CONDITIONAL_HOOK",
          file, fn: name, hook: h.name, hookLine: at(h.pos), returnLine: null,
        });
      }
    }

    const scan = (node) => {
      if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
        const name = functionName(node);
        if (isReactFunction(name)) analyse(node, name);
      }
      node.forEachChild(scan);
    };
    scan(src);
  }
}

const rel = (f) => path.relative(REPO, f).replace(/\\/g, "/");
if (!findings.length) {
  console.log("PASS — no Rules-of-Hooks violations found");
} else {
  console.log(`FOUND ${findings.length} potential violation(s):\n`);
  for (const f of findings) {
    if (f.kind === "HOOK_AFTER_EARLY_RETURN") {
      console.log(`  [hook-after-return] ${rel(f.file)}  ${f.fn}()`);
      console.log(`      early return at line ${f.returnLine}, then ${f.hook}() at line ${f.hookLine}`);
    } else {
      console.log(`  [conditional-hook]  ${rel(f.file)}  ${f.fn}()  ${f.hook}() at line ${f.hookLine}`);
    }
  }
}
process.exit(findings.length ? 1 : 0);
