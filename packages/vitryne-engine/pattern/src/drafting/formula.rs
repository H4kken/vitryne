// SPDX-License-Identifier: AGPL-3.0-or-later
//! The formula language of Valentina and Seamly2D patterns: every length, angle and measurement
//! in their files is an expression such as `(hip_circ/4) + 1.27` or `max(0;(#WG/4-1))`.
//!
//! It is the muParser dialect both apps use (their `qmuparser`, BSD), as written to files: the C
//! locale (`.` decimal point), `;` between function arguments, and these rules:
//!   - operators, lowest first: `?:` (right), `||`, `&&`, `< > <= >= == !=`, `+ -`, `* /`, a
//!     sign (`-x`), `^` (right; `-2^2` is -4);
//!   - names are letters of any script, digits (not first), `_`, `@` (custom measurements), `#`
//!     (increments) and `'`; tools add names like `Line_A_B`;
//!   - functions: trig in radians (`sin`) and degrees (`sinD`), their inverses, hyperbolic, logs
//!     (`log` is base 10), `sqrt`, `exp`, `abs`, `sign`, `rint`, `r2cm`, `fmod`, `min`, `max`,
//!     `sum`, `avg` (any number of arguments), `degTorad`, `radTodeg`, `warning("text"; value)`;
//!   - constants `_pi`, `_e`;
//!   - a formula may be statements, `#a = …; #b = …; result`: the last value counts.
//!
//! Unknown names are errors that name them (the apps treat an unknown increment as NaN; a
//! missing value is better reported than drawn).

use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    Num(f64),
    Var(String),
    /// Only as `warning`'s first argument.
    Str(String),
    Neg(Box<Expr>),
    Bin(Op, Box<Expr>, Box<Expr>),
    If(Box<Expr>, Box<Expr>, Box<Expr>),
    Call(String, Vec<Expr>),
    /// `#a = 1; #b = #a * 2; #b + 1`: local names set in order, then the last expression.
    Let(Vec<(String, Expr)>, Box<Expr>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    Or,
    And,
    Lt,
    Gt,
    Le,
    Ge,
    Eq,
    Ne,
    Add,
    Sub,
    Mul,
    Div,
    Pow,
}

impl Op {
    /// Binding strength (muParser's `EOprtPrecedence`), `^` is handled apart.
    fn precedence(self) -> u8 {
        match self {
            Op::Or => 1,
            Op::And => 2,
            Op::Lt | Op::Gt | Op::Le | Op::Ge | Op::Eq | Op::Ne => 4,
            Op::Add | Op::Sub => 5,
            Op::Mul | Op::Div => 6,
            Op::Pow => 7,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Num(f64),
    Name(String),
    Str(String),
    Op(Op),
    Not,
    Plus,
    Minus,
    Question,
    Colon,
    Open,
    Close,
    Sep,
    Assign,
}

impl fmt::Display for Tok {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Tok::Num(v) => write!(f, "{v}"),
            Tok::Name(n) => write!(f, "{n}"),
            Tok::Str(s) => write!(f, "\"{s}\""),
            Tok::Op(o) => write!(f, "{o:?}"),
            Tok::Not => write!(f, "!"),
            Tok::Plus => write!(f, "+"),
            Tok::Minus => write!(f, "-"),
            Tok::Question => write!(f, "?"),
            Tok::Colon => write!(f, ":"),
            Tok::Open => write!(f, "("),
            Tok::Close => write!(f, ")"),
            Tok::Sep => write!(f, ";"),
            Tok::Assign => write!(f, "="),
        }
    }
}

fn is_name_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '@' | '#' | '\'')
}

fn tokenize(src: &str) -> Result<Vec<Tok>, String> {
    let cs: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < cs.len() {
        let c = cs[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c.is_ascii_digit() || (c == '.' && cs.get(i + 1).is_some_and(|d| d.is_ascii_digit())) {
            let start = i;
            while i < cs.len() && (cs[i].is_ascii_digit() || cs[i] == '.') {
                i += 1;
            }
            // An exponent only when digits follow (`2e` could start a name).
            if i < cs.len() && (cs[i] == 'e' || cs[i] == 'E') {
                let mut j = i + 1;
                if j < cs.len() && (cs[j] == '+' || cs[j] == '-') {
                    j += 1;
                }
                if j < cs.len() && cs[j].is_ascii_digit() {
                    i = j;
                    while i < cs.len() && cs[i].is_ascii_digit() {
                        i += 1;
                    }
                }
            }
            let text: String = cs[start..i].iter().collect();
            let v = text
                .parse::<f64>()
                .map_err(|_| format!("bad number \"{text}\""))?;
            out.push(Tok::Num(v));
            continue;
        }
        if is_name_char(c) {
            let start = i;
            while i < cs.len() && is_name_char(cs[i]) {
                i += 1;
            }
            out.push(Tok::Name(cs[start..i].iter().collect()));
            continue;
        }
        if c == '"' {
            let start = i + 1;
            i = start;
            while i < cs.len() && cs[i] != '"' {
                i += 1;
            }
            if i == cs.len() {
                return Err("a text is not closed (\")".into());
            }
            out.push(Tok::Str(cs[start..i].iter().collect()));
            i += 1;
            continue;
        }
        let next = cs.get(i + 1).copied();
        let (tok, len) = match (c, next) {
            ('<', Some('=')) => (Tok::Op(Op::Le), 2),
            ('>', Some('=')) => (Tok::Op(Op::Ge), 2),
            ('=', Some('=')) => (Tok::Op(Op::Eq), 2),
            ('!', Some('=')) => (Tok::Op(Op::Ne), 2),
            ('&', Some('&')) => (Tok::Op(Op::And), 2),
            ('|', Some('|')) => (Tok::Op(Op::Or), 2),
            ('<', _) => (Tok::Op(Op::Lt), 1),
            ('>', _) => (Tok::Op(Op::Gt), 1),
            ('*', _) => (Tok::Op(Op::Mul), 1),
            ('/', _) => (Tok::Op(Op::Div), 1),
            ('^', _) => (Tok::Op(Op::Pow), 1),
            ('!', _) => (Tok::Not, 1),
            ('=', _) => (Tok::Assign, 1),
            // U+2212 is the minus sign some locales type.
            ('-' | '\u{2212}', _) => (Tok::Minus, 1),
            ('+', _) => (Tok::Plus, 1),
            ('?', _) => (Tok::Question, 1),
            (':', _) => (Tok::Colon, 1),
            ('(', _) => (Tok::Open, 1),
            (')', _) => (Tok::Close, 1),
            (';', _) => (Tok::Sep, 1),
            _ => return Err(format!("unexpected \"{c}\"")),
        };
        out.push(tok);
        i += len;
    }
    Ok(out)
}

struct Parser {
    toks: Vec<Tok>,
    at: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.at)
    }

    fn next(&mut self) -> Option<Tok> {
        let t = self.toks.get(self.at).cloned();
        self.at += 1;
        t
    }

    fn expect(&mut self, want: Tok) -> Result<(), String> {
        match self.next() {
            Some(t) if t == want => Ok(()),
            Some(t) => Err(format!("expected \"{want}\", found \"{t}\"")),
            None => Err(format!("expected \"{want}\" at the end")),
        }
    }

    /// `c ? a : b`, right associative, lowest of all.
    fn ternary(&mut self) -> Result<Expr, String> {
        let c = self.binary(1)?;
        if self.peek() == Some(&Tok::Question) {
            self.at += 1;
            let a = self.ternary()?;
            self.expect(Tok::Colon)?;
            let b = self.ternary()?;
            return Ok(Expr::If(Box::new(c), Box::new(a), Box::new(b)));
        }
        Ok(c)
    }

    fn binary_op(&self) -> Option<Op> {
        match self.peek()? {
            Tok::Op(Op::Pow) => None,
            Tok::Op(o) => Some(*o),
            Tok::Plus => Some(Op::Add),
            Tok::Minus => Some(Op::Sub),
            _ => None,
        }
    }

    /// Left-associative binary operators of precedence `min` and up (below `^`).
    fn binary(&mut self, min: u8) -> Result<Expr, String> {
        let mut lhs = self.unary()?;
        while let Some(op) = self.binary_op().filter(|o| o.precedence() >= min) {
            self.at += 1;
            let rhs = self.binary(op.precedence() + 1)?;
            lhs = Expr::Bin(op, Box::new(lhs), Box::new(rhs));
        }
        Ok(lhs)
    }

    /// A sign binds tighter than `*` and looser than `^`.
    fn unary(&mut self) -> Result<Expr, String> {
        match self.peek() {
            Some(Tok::Minus) => {
                self.at += 1;
                Ok(Expr::Neg(Box::new(self.unary()?)))
            }
            Some(Tok::Plus) => {
                self.at += 1;
                self.unary()
            }
            Some(Tok::Not) => {
                self.at += 1;
                let e = self.unary()?;
                Ok(Expr::Call("!".into(), vec![e]))
            }
            _ => self.power(),
        }
    }

    fn power(&mut self) -> Result<Expr, String> {
        let base = self.primary()?;
        if self.peek() == Some(&Tok::Op(Op::Pow)) {
            self.at += 1;
            let exp = self.unary()?;
            return Ok(Expr::Bin(Op::Pow, Box::new(base), Box::new(exp)));
        }
        Ok(base)
    }

    fn primary(&mut self) -> Result<Expr, String> {
        match self.next() {
            Some(Tok::Num(v)) => Ok(Expr::Num(v)),
            Some(Tok::Str(s)) => Ok(Expr::Str(s)),
            Some(Tok::Open) => {
                let e = self.ternary()?;
                self.expect(Tok::Close)?;
                Ok(e)
            }
            Some(Tok::Name(n)) => {
                if self.peek() == Some(&Tok::Open) {
                    self.at += 1;
                    let mut args = Vec::new();
                    if self.peek() == Some(&Tok::Close) {
                        self.at += 1;
                    } else {
                        loop {
                            args.push(self.ternary()?);
                            match self.next() {
                                Some(Tok::Sep) => continue,
                                Some(Tok::Close) => break,
                                Some(t) => {
                                    return Err(format!("expected \";\" or \")\", found \"{t}\""));
                                }
                                None => return Err(format!("{n}( is not closed")),
                            }
                        }
                    }
                    Ok(Expr::Call(n, args))
                } else {
                    Ok(Expr::Var(n))
                }
            }
            Some(t) => Err(format!("unexpected \"{t}\"")),
            None => Err("the formula ends too early".into()),
        }
    }
}

/// Parses a formula.
pub fn parse(src: &str) -> Result<Expr, String> {
    let mut p = Parser {
        toks: tokenize(src)?,
        at: 0,
    };
    if p.toks.is_empty() {
        return Err("empty formula".into());
    }
    // Statements: `name = expr;` any number of times, then the result (muParser's top-level
    // `;` list, of which the last value counts).
    let mut lets = Vec::new();
    loop {
        if let (Some(Tok::Name(n)), Some(Tok::Assign)) = (p.toks.get(p.at), p.toks.get(p.at + 1)) {
            let n = n.clone();
            p.at += 2;
            lets.push((n, p.ternary()?));
        } else {
            let e = p.ternary()?;
            match p.next() {
                None => {
                    return Ok(if lets.is_empty() {
                        e
                    } else {
                        Expr::Let(lets, Box::new(e))
                    });
                }
                // A plain value before `;` is computed and dropped.
                Some(Tok::Sep) => lets.push((String::new(), e)),
                Some(t) => return Err(format!("unexpected \"{t}\"")),
            }
            continue;
        }
        match p.next() {
            Some(Tok::Sep) => {}
            Some(t) => return Err(format!("unexpected \"{t}\"")),
            None => return Err("the formula ends with an assignment".into()),
        }
    }
}

/// Where names get their values.
pub trait Scope {
    fn get(&self, name: &str) -> Option<f64>;
}

impl<F: Fn(&str) -> Option<f64>> Scope for F {
    fn get(&self, name: &str) -> Option<f64> {
        self(name)
    }
}

/// The newest local value of `name`, else the scope's.
fn lookup(local: &[(&str, f64)], scope: &dyn Scope, name: &str) -> Option<f64> {
    local
        .iter()
        .rev()
        .find(|(n, _)| *n == name)
        .map(|(_, v)| *v)
        .or_else(|| scope.get(name))
}

fn truth(v: f64) -> bool {
    v != 0.0
}

fn bool_num(b: bool) -> f64 {
    if b { 1.0 } else { 0.0 }
}

fn rint(v: f64) -> f64 {
    (v + 0.5).floor()
}

fn call(name: &str, args: &[f64]) -> Result<f64, String> {
    let one = |f: fn(f64) -> f64| -> Result<f64, String> {
        match args {
            [x] => Ok(f(*x)),
            _ => Err(format!("{name} takes one argument, not {}", args.len())),
        }
    };
    let two = |f: fn(f64, f64) -> f64| -> Result<f64, String> {
        match args {
            [x, y] => Ok(f(*x, *y)),
            _ => Err(format!("{name} takes two arguments, not {}", args.len())),
        }
    };
    let many = |f: fn(&[f64]) -> f64| -> Result<f64, String> {
        if args.is_empty() {
            Err(format!("{name} needs at least one argument"))
        } else {
            Ok(f(args))
        }
    };
    match name {
        "!" => one(|x| bool_num(!truth(x))),
        "sin" => one(f64::sin),
        "cos" => one(f64::cos),
        "tan" => one(f64::tan),
        "sinD" => one(|x| x.to_radians().sin()),
        "cosD" => one(|x| x.to_radians().cos()),
        "tanD" => one(|x| x.to_radians().tan()),
        "asin" => one(f64::asin),
        "acos" => one(f64::acos),
        "atan" => one(f64::atan),
        "atan2" => two(f64::atan2),
        "asinD" => one(|x| x.asin().to_degrees()),
        "acosD" => one(|x| x.acos().to_degrees()),
        "atanD" => one(|x| x.atan().to_degrees()),
        "sinh" => one(f64::sinh),
        "cosh" => one(f64::cosh),
        "tanh" => one(f64::tanh),
        "asinh" => one(f64::asinh),
        "acosh" => one(f64::acosh),
        "atanh" => one(f64::atanh),
        "log2" => one(f64::log2),
        "log10" | "log" => one(f64::log10),
        "ln" => one(f64::ln),
        "exp" => one(f64::exp),
        "sqrt" => one(f64::sqrt),
        "sign" => one(|x| {
            if x < 0.0 {
                -1.0
            } else if x > 0.0 {
                1.0
            } else {
                0.0
            }
        }),
        "rint" => one(rint),
        "r2cm" => one(|x| rint(x * 10.0) / 10.0),
        "abs" => one(f64::abs),
        "fmod" => two(|x, y| x % y),
        "degTorad" => one(f64::to_radians),
        "radTodeg" => one(f64::to_degrees),
        "sum" => many(|a| a.iter().sum()),
        "avg" => many(|a| a.iter().sum::<f64>() / a.len() as f64),
        "min" => many(|a| a.iter().copied().fold(f64::INFINITY, f64::min)),
        "max" => many(|a| a.iter().copied().fold(f64::NEG_INFINITY, f64::max)),
        _ => Err(format!("unknown function {name}")),
    }
}

impl Expr {
    pub fn eval(&self, scope: &dyn Scope) -> Result<f64, String> {
        Ok(match self {
            Expr::Num(v) => *v,
            Expr::Var(n) => match n.as_str() {
                "_pi" => std::f64::consts::PI,
                "_e" => std::f64::consts::E,
                _ => scope.get(n).ok_or_else(|| format!("unknown name {n}"))?,
            },
            Expr::Str(s) => return Err(format!("text \"{s}\" where a number is expected")),
            Expr::Neg(e) => -e.eval(scope)?,
            Expr::If(c, a, b) => {
                if truth(c.eval(scope)?) {
                    a.eval(scope)?
                } else {
                    b.eval(scope)?
                }
            }
            Expr::Bin(op, a, b) => {
                let (x, y) = (a.eval(scope)?, b.eval(scope)?);
                match op {
                    Op::Or => bool_num(truth(x) || truth(y)),
                    Op::And => bool_num(truth(x) && truth(y)),
                    Op::Lt => bool_num(x < y),
                    Op::Gt => bool_num(x > y),
                    Op::Le => bool_num(x <= y),
                    Op::Ge => bool_num(x >= y),
                    Op::Eq => bool_num(x == y),
                    Op::Ne => bool_num(x != y),
                    Op::Add => x + y,
                    Op::Sub => x - y,
                    Op::Mul => x * y,
                    Op::Div => x / y,
                    Op::Pow => x.powf(y),
                }
            }
            // A warning in the author's app; here its value.
            Expr::Call(n, args) if n == "warning" => match args.as_slice() {
                [Expr::Str(_), v] => v.eval(scope)?,
                _ => return Err("warning takes a text and a value".into()),
            },
            Expr::Call(n, args) => {
                let vals = args
                    .iter()
                    .map(|a| a.eval(scope))
                    .collect::<Result<Vec<_>, _>>()?;
                call(n, &vals)?
            }
            Expr::Let(lets, last) => {
                let mut local: Vec<(&str, f64)> = Vec::new();
                for (n, e) in lets {
                    let v = e.eval(&|name: &str| lookup(&local, scope, name))?;
                    local.push((n.as_str(), v));
                }
                last.eval(&|name: &str| lookup(&local, scope, name))?
            }
        })
    }

    /// Every name the formula uses, in order of appearance, without repeats.
    pub fn names(&self) -> Vec<String> {
        fn walk(e: &Expr, out: &mut Vec<String>) {
            match e {
                Expr::Var(n) if n != "_pi" && n != "_e" => {
                    if !out.contains(n) {
                        out.push(n.clone());
                    }
                }
                Expr::Neg(a) => walk(a, out),
                Expr::Bin(_, a, b) => {
                    walk(a, out);
                    walk(b, out);
                }
                Expr::If(c, a, b) => {
                    walk(c, out);
                    walk(a, out);
                    walk(b, out);
                }
                Expr::Call(_, args) => args.iter().for_each(|a| walk(a, out)),
                Expr::Let(lets, last) => {
                    // Names set here aren't needed from outside.
                    let mut inner = Vec::new();
                    lets.iter().for_each(|(_, e)| walk(e, &mut inner));
                    walk(last, &mut inner);
                    for n in inner {
                        if !lets.iter().any(|(l, _)| *l == n) && !out.contains(&n) {
                            out.push(n);
                        }
                    }
                }
                _ => {}
            }
        }
        let mut out = Vec::new();
        walk(self, &mut out);
        out
    }
}

/// Parses and evaluates; a plain number skips the parser. The error quotes the formula.
pub fn eval(src: &str, scope: &dyn Scope) -> Result<f64, String> {
    if let Ok(v) = src.trim().parse::<f64>() {
        return Ok(v);
    }
    let v = parse(src)
        .and_then(|e| e.eval(scope))
        .map_err(|e| format!("formula \"{src}\": {e}"))?;
    if v.is_finite() {
        Ok(v)
    } else {
        Err(format!("formula \"{src}\" gives {v}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(name: &str) -> Option<f64> {
        match name {
            "hip_circ" => Some(100.0),
            "Line_A_C" => Some(26.27),
            "#WG" => Some(70.0),
            "#WG_ease" => Some(2.0),
            "@моя" => Some(3.0),
            "A1'" => Some(5.0),
            _ => None,
        }
    }

    fn ev(src: &str) -> f64 {
        eval(src, &scope).unwrap()
    }

    #[test]
    fn numbers_and_arithmetic() {
        assert_eq!(ev("12.5"), 12.5);
        assert_eq!(ev(".5 + 1e2"), 100.5);
        assert_eq!(ev("(hip_circ/4) + 1.27"), 26.27);
        assert_eq!(ev("10 - 4 - 3"), 3.0);
        assert_eq!(ev("12 / 4 / 3"), 1.0);
        assert_eq!(ev("2 + 3 * 4"), 14.0);
    }

    #[test]
    fn signs_and_powers() {
        assert_eq!(ev("-2^2"), -4.0);
        assert_eq!(ev("2^3^2"), 512.0);
        assert_eq!(ev("2^-1"), 0.5);
        assert_eq!(ev("3*-2"), -6.0);
        assert_eq!(ev("-hip_circ/4"), -25.0);
        assert_eq!(ev("\u{2212}1"), -1.0);
    }

    #[test]
    fn functions_take_semicolons() {
        assert!((ev("max(0;((Line_A_C-(#WG/4-1))/2))") - 4.885).abs() < 1e-12);
        assert_eq!(ev("max(0;((Line_A_C-(#WG/4+10))/2))"), 0.0);
        assert_eq!(ev("min(2;(max(0;(#WG/2+#WG_ease))))"), 2.0);
        assert_eq!(ev("sum(1;2;3)"), 6.0);
        assert_eq!(ev("avg(1;2;3)"), 2.0);
        assert!((ev("sinD(30)") - 0.5).abs() < 1e-12);
        assert!((ev("acosD(0)") - 90.0).abs() < 1e-12);
        assert!((ev("sin(_pi/2)") - 1.0).abs() < 1e-12);
        assert_eq!(ev("log(1000)"), 3.0);
        assert_eq!(ev("r2cm(1.26)"), 1.3);
        assert_eq!(ev("fmod(7;3)"), 1.0);
        assert_eq!(ev("warning(\"too small\"; 4)"), 4.0);
    }

    #[test]
    fn logic_and_conditions() {
        assert_eq!(ev("hip_circ > 90 ? 1 : 2"), 1.0);
        assert_eq!(ev("1 < 0 ? 1 : 0 ? 2 : 3"), 3.0);
        assert_eq!(ev("1 && 0 || 1"), 1.0);
        assert_eq!(ev("2 + 3 == 5"), 1.0);
        assert_eq!(ev("!0"), 1.0);
    }

    #[test]
    fn statements_set_local_names() {
        let src = "#d = Line_A_C - 6.27;\n#e = #d * 2;\n\n#e + hip_circ";
        assert_eq!(ev(src), 140.0);
        assert_eq!(parse(src).unwrap().names(), vec!["Line_A_C", "hip_circ"]);
        assert_eq!(ev("1; 2"), 2.0);
        assert!(eval("#a = 1;", &scope).is_err());
    }

    #[test]
    fn names_of_any_script() {
        assert_eq!(ev("@моя * 2"), 6.0);
        assert_eq!(ev("A1' + 1"), 6.0);
        assert_eq!(
            parse("Line_A_C + max(#WG; hip_circ) + Line_A_C")
                .unwrap()
                .names(),
            vec!["Line_A_C", "#WG", "hip_circ"]
        );
    }

    #[test]
    fn errors_name_what_is_wrong() {
        let e = eval("waist_circ / 4", &scope).unwrap_err();
        assert!(e.contains("unknown name waist_circ"), "{e}");
        assert!(eval("(1 + 2", &scope).is_err());
        assert!(eval("1 +", &scope).is_err());
        assert!(eval("1 / 0", &scope).unwrap_err().contains("inf"));
        assert!(
            eval("nope(1)", &scope)
                .unwrap_err()
                .contains("unknown function")
        );
    }
}
