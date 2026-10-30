/**
 * 对齐 wormhole common_safeEval / common_getDeepValue（MV3 合规，无 eval / new Function）
 * 支持：括号、优先级、成员访问、下标、函数调用、三元、逻辑/比较/算术、可选链 ?.
 * getDeepValue / deepResolve 支持对象字段 __ref 展开合并
 */

type Token = { type: string; value: unknown };

function getErrorInfo(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tokenize(str: string): Token[] {
  // >= <= 排在 > < 前；?. 排在 ? 前（原版字符类漏了单独的 > <，这里补上）
  const regex =
    /\s*(=>|\?\.|==|!=|>=|<=|&&|\|\||[<>+\-*/%?:!().,[\]]|['"](?:\\.|[^'"])*['"]|\d+(?:\.\d+)?|\w+)\s*/g;
  const result: Token[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(str)) !== null) {
    const v = m[1];
    if (v[0] === "'" || v[0] === '"') {
      result.push({ type: "string", value: v.slice(1, -1) });
    } else if (/\d/.test(v[0])) {
      result.push({ type: "number", value: Number(v) });
    } else if (
      (v.length === 1 && /[<>+\-*/%?:!().,[\]]/.test(v)) ||
      ["==", "!=", ">=", "<=", "&&", "||", "?.", "=>"].includes(v)
    ) {
      result.push({ type: "operator", value: v });
    } else {
      result.push({ type: "identifier", value: v });
    }
  }
  return result;
}

/** MV3 合规表达式求值，对齐 wormhole common_safeEval */
export function safeEval(context: Record<string, unknown> | null | undefined, expression: unknown): unknown {
  let s = String(expression ?? "").trim();
  if (s.startsWith("${") && s.endsWith("}")) {
    s = s.substring(2, s.length - 1);
  }

  let i = 0;
  const tokens = tokenize(s);
  /** >0 时只消费 token 不求值：短路掉的 || / && 右侧、三元未选中的分支 */
  let skipping = 0;

  function consume(v: string): boolean {
    if (tokens[i] && tokens[i].value === v) {
      i++;
      return true;
    }
    return false;
  }

  function skip(parse: () => unknown): void {
    skipping++;
    try {
      parse();
    } finally {
      skipping--;
    }
  }

  function parseExpression(): unknown {
    return parseTernary();
  }

  function parseTernary(): unknown {
    const left = parseLogicalOr();
    if (consume("?")) {
      let result: unknown;
      if (left) result = parseTernary();
      else skip(parseTernary);
      consume(":");
      if (left) skip(parseTernary);
      else result = parseTernary();
      return result;
    }
    return left;
  }

  function parseLogicalOr(): unknown {
    let left = parseLogicalAnd();
    while (consume("||")) {
      if (left) skip(parseLogicalAnd);
      else left = parseLogicalAnd();
    }
    return left;
  }

  function parseLogicalAnd(): unknown {
    let left = parseComparison();
    while (consume("&&")) {
      if (!left) skip(parseComparison);
      else left = parseComparison();
    }
    return left;
  }

  function parseComparison(): unknown {
    const left = parseAdditive();
    const ops = ["==", "!=", ">=", "<=", ">", "<"] as const;
    for (const op of ops) {
      if (consume(op)) {
        const right = parseAdditive();
        if (op === "==") return left == right;
        if (op === "!=") return left != right;
        if (op === ">=") return (left as number) >= (right as number);
        if (op === "<=") return (left as number) <= (right as number);
        if (op === ">") return (left as number) > (right as number);
        if (op === "<") return (left as number) < (right as number);
      }
    }
    return left;
  }

  function parseAdditive(): unknown {
    let left = parseMultiplicative() as number;
    while (true) {
      if (consume("+")) left = (left as number) + (parseMultiplicative() as number);
      else if (consume("-")) left = (left as number) - (parseMultiplicative() as number);
      else break;
    }
    return left;
  }

  function parseMultiplicative(): unknown {
    let left = parseUnary() as number;
    while (true) {
      if (consume("*")) left = (left as number) * (parseUnary() as number);
      else if (consume("/")) left = (left as number) / (parseUnary() as number);
      else if (consume("%")) left = (left as number) % (parseUnary() as number);
      else break;
    }
    return left;
  }

  function parseUnary(): unknown {
    if (consume("!")) return !parseUnary();
    if (consume("-")) return -(parseUnary() as number);
    return parsePrimary();
  }

  function parsePrimary(): unknown {
    const token = tokens[i++];
    if (!token) return undefined;

    // 原版用 type==='paren'，但 tokenize 把 ( 标成 operator；这里按 value 判断
    if (token.value === "(") {
      const val = parseExpression();
      consume(")");
      return parseAccess(val);
    }
    if (token.value === "[") {
      const items: unknown[] = [];
      if (tokens[i] && tokens[i].value !== "]") {
        items.push(parseExpression());
        while (consume(",")) items.push(parseExpression());
      }
      consume("]");
      return parseAccess(items);
    }

    let val: unknown;
    if (token.type === "number") val = token.value;
    else if (token.type === "string") val = token.value;
    else if (token.type === "identifier") {
      const name = String(token.value);
      if (name === "true") val = true;
      else if (name === "false") val = false;
      else if (name === "null") val = null;
      else if (name === "undefined") val = undefined;
      else if (name === "Math") val = Math;
      else if (name === "Date") val = Date;
      else if (name === "JSON") val = JSON;
      else val = context ? context[name] : undefined;
    }

    return parseAccess(val);
  }

  function parseAccess(val: unknown): unknown {
    if (skipping) {
      while (true) {
        if (consume("?.") || consume(".")) i++;
        else if (consume("[")) {
          parseExpression();
          consume("]");
        } else if (consume("(")) {
          if (tokens[i] && tokens[i].value !== ")") {
            parseExpression();
            while (consume(",")) parseExpression();
          }
          consume(")");
        } else break;
      }
      return undefined;
    }
    while (true) {
      if (consume("?.")) {
        const token = tokens[i++];
        if (!token) return undefined;
        if (val == null) {
          // 吞掉后续调用/下标：a?.b(c)[d] 在 a 为空时整体 undefined
          while (consume("(") || consume("[")) {
            if (tokens[i - 1].value === "(") {
              if (tokens[i] && tokens[i].value !== ")") {
                parseExpression();
                while (consume(",")) parseExpression();
              }
              consume(")");
            } else {
              parseExpression();
              consume("]");
            }
          }
          return undefined;
        }
        const name = String(token.value);
        const obj = val as Record<string, unknown>;
        const member = obj[name];
        val = typeof member === "function" ? (member as (...a: unknown[]) => unknown).bind(val) : member;
      } else if (consume(".")) {
        const token = tokens[i++];
        const name = String(token.value);
        const obj = val as Record<string, unknown>;
        const member = obj[name];
        val = typeof member === "function" ? (member as (...a: unknown[]) => unknown).bind(val) : member;
      } else if (consume("[")) {
        const index = parseExpression();
        consume("]");
        val = (val as Record<string | number | symbol, unknown>)[index as string | number];
      } else if (consume("(")) {
        const args: unknown[] = [];
        if (tokens[i] && tokens[i].value !== ")") {
          args.push(parseExpression());
          while (consume(",")) args.push(parseExpression());
        }
        consume(")");
        val = (val as (...a: unknown[]) => unknown)(...args);
      } else {
        break;
      }
    }
    return val;
  }

  try {
    return parseExpression();
  } catch (error) {
    console.error("[safeEval] error", { context, expression, error });
    throw new Error(`eval ${String(expression)} failed: ${getErrorInfo(error)}`);
  }
}

/**
 * 字符串里嵌入的 ${...} 替换（用于 url 等）；整段 ${...} 直接求值
 */
/** 整个字符串就是一个 ${expr}（返回原始类型）；"${a}-${b}" 这类模板不算 */
export function isWholeExpr(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("${") && trimmed.endsWith("}") && trimmed.indexOf("${", 2) === -1;
}

export function resolveMaybeExpr(variables: Record<string, unknown>, value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (isWholeExpr(trimmed)) return safeEval(variables, trimmed);
  return value.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
    try {
      return String(safeEval(variables, `\${${expr}}`));
    } catch {
      return "";
    }
  });
}

/**
 * 对齐 wormhole common_getDeepValue：
 * - 整段 ${...} 字符串 → safeEval（保留原始类型）；"${a}-${b}" 模板 → 插值成字符串
 * - 数组递归
 * - 对象字段 __ref → 展开合并进当前对象
 */
export function getDeepValue(context: Record<string, unknown>, value: unknown): unknown {
  if (typeof value === "string" && value.includes("${")) {
    return resolveMaybeExpr(context, value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => getDeepValue(context, item));
  }
  if (value && typeof value === "object") {
    let newObj: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const child = (value as Record<string, unknown>)[key];
      if (key === "__ref") {
        const refVal = getDeepValue(context, child);
        if (refVal && typeof refVal === "object" && !Array.isArray(refVal)) {
          newObj = { ...newObj, ...(refVal as Record<string, unknown>) };
        }
      } else {
        newObj[key] = getDeepValue(context, child);
      }
    }
    return newObj;
  }
  return value;
}

/** call_api_params 等深层替换；同 getDeepValue（含 __ref） */
export function deepResolve(variables: Record<string, unknown>, input: unknown): unknown {
  return getDeepValue(variables, input);
}
