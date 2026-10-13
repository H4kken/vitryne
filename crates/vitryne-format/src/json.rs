// SPDX-License-Identifier: AGPL-3.0-or-later
//! How writers lay out JSON (FORMAT.md, Numbers and JSON): 2-space indent, and arrays of
//! numbers (points, vectors) on one line, so a diff shows one changed point as one line.

use serde_json::Value;

pub fn to_pretty(v: &Value) -> String {
    let mut out = String::new();
    write(&mut out, v, 0);
    out.push('\n');
    out
}

fn write(out: &mut String, v: &Value, indent: usize) {
    let pad = |out: &mut String, n: usize| out.extend(std::iter::repeat_n(' ', n));
    match v {
        Value::Array(a) if a.is_empty() => out.push_str("[]"),
        Value::Array(a) if a.iter().all(Value::is_number) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                out.push_str(&x.to_string());
            }
            out.push(']');
        }
        Value::Array(a) => {
            out.push_str("[\n");
            for (i, x) in a.iter().enumerate() {
                pad(out, indent + 2);
                write(out, x, indent + 2);
                out.push_str(if i + 1 < a.len() { ",\n" } else { "\n" });
            }
            pad(out, indent);
            out.push(']');
        }
        Value::Object(m) if m.is_empty() => out.push_str("{}"),
        Value::Object(m) => {
            out.push_str("{\n");
            for (i, (k, x)) in m.iter().enumerate() {
                pad(out, indent + 2);
                out.push_str(&Value::String(k.clone()).to_string());
                out.push_str(": ");
                write(out, x, indent + 2);
                out.push_str(if i + 1 < m.len() { ",\n" } else { "\n" });
            }
            pad(out, indent);
            out.push('}');
        }
        other => out.push_str(&other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn points_stay_on_one_line() {
        let v = serde_json::json!({"a": [[1.5, -2.0], [3.0, 4.25]], "b": [], "c": {}, "d": "x\"y", "e": [{"f": 1}]});
        assert_eq!(
            to_pretty(&v),
            "{\n  \"a\": [\n    [1.5, -2.0],\n    [3.0, 4.25]\n  ],\n  \"b\": [],\n  \"c\": {},\n  \"d\": \"x\\\"y\",\n  \"e\": [\n    {\n      \"f\": 1\n    }\n  ]\n}\n"
        );
        assert_eq!(serde_json::from_str::<Value>(&to_pretty(&v)).unwrap(), v);
    }
}
