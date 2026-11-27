# Operations: the expression subset

Every computed value in an operation (a field, a condition, a list to loop over, a where) is an
expression: a string in a `{ "$": "…" }` value ([Values](format.md#values)). This file specifies the
**core subset** of WE's expression language: the grammar, what each form evaluates to, the
where-object, and the core function library. An operation MUST use only this subset. There are no
host functions in it: a function one host provides would mean nothing on another.

The same language, with host functions and more names, is used by templates. That is specified in the
template format; nothing here depends on it.

## Values

An expression evaluates to one of:

| Kind     | Notes                                                                                 |
| -------- | ------------------------------------------------------------------------------------- |
| no value | What an unbound path, a missing field or a failed lookup gives. Distinct from `null`. |
| `null`   | The literal `null`, or a JSON `null` read from data.                                  |
| boolean  | `true`, `false`.                                                                      |
| number   | An IEEE 754 double.                                                                   |
| text     | A string of UTF-16 code units (see [Text](#text-is-utf-16)).                          |
| list     | An ordered list of values.                                                            |
| object   | A map of text keys to values: a record, or an object built by an expression.          |

No value and `null` are different values to `==` (`missing == null` is `false`), and the same to
`??` and to every function that speaks of "absent" below. The data model treats both, and `''`, as no
value ([The absent-value rule](README.md#the-absent-value-rule)).

When an operation's result or a field leaves the expression language, no value is written as absent
(the key left out), and `null` as JSON `null`.

### Truthiness

Falsy: no value, `null`, `false`, `0`, `-0`, NaN, and `''`. Everything else is truthy, including
`[]`, `{}` and `'0'`.

### Conversions

**Reads as a number** (used by arithmetic, comparison and number functions): a finite number is
itself, and text is a number when the whole of it is a decimal numeral,
`[+-]?(digits[.digits?] | .digits)([eE][+-]?digits)?` with no white space, and its value is finite
(`'3'`, `'-2.5'`, `'1e3'`). Nothing else reads as a number: not no value or `null`, not `true` or
`false`, not `''`, padded text (`' 3'`), `0x10` or `Infinity`, and not a list or an object (`[5]` is
not `5`).

**To number** (used by arithmetic and number functions): the number a value reads as, and `0` for a
value that reads as none. A missing operand is `0` this way, and so is a list.

**No `-0`.** No number the language produces is `-0`: wherever arithmetic or a number function
would give `-0` (`-missing`, `0 * -1`, `-1 % 1`, `round(-0.4)`, `min(0, -0)`), the result is `0`.

**To text** (used by `+` with text, interpolation and text functions): no value and `null` are `''`;
text is itself; `true`/`false` are `'true'`/`'false'`; a number is ECMAScript `Number::toString`
(`1`, `1.5`, `0.1`, `1e+21`, `NaN`); a list is its entries converted to text (no value and `null`
entries as `''`) joined by `,`; an object is `'[object Object]'`. An operation SHOULD NOT depend on
the text of a list or an object.

### Text is UTF-16

Text is measured and indexed in UTF-16 code units: `'é'.length` is 1, `'😀'.length` is 2, and
`s[i]` is one code unit. Where a function orders or compares text, it says which unit it uses.

> **Why.** It is what the reference implementation does. An implementation in a language with
> another string model has to emulate it for `length`, indexing and `split('')` until a later version
> changes them.

## Grammar

ISO 14977 EBNF over the characters of the expression string. White space (space, tab, line feed,
carriage return) may appear between any two tokens and is otherwise ignored.

```ebnf
Expression     = Coalesce , [ "?" , Expression , ":" , Expression ] ;
Coalesce       = Or , { "??" , Or } ;
Or             = And , { "||" , And } ;
And            = Equality , { "&&" , Equality } ;
Equality       = Relational , { ( "==" | "!=" ) , Relational } ;
Relational     = Additive , { ( "<=" | ">=" | "<" | ">" | "in" ) , Additive } ;
Additive       = Multiplicative , { ( "+" | "-" ) , Multiplicative } ;
Multiplicative = Unary , { ( "*" | "/" | "%" ) , Unary } ;
Unary          = ( "!" | "-" ) , Unary | Postfix ;
Postfix        = Primary , { Member | Index } ;
Member         = "." , PropertyName , [ Arguments | Comprehension ] ;
Index          = "[" , Expression , "]" ;
Primary        = Number | String | Template | "true" | "false" | "null"
               | Identifier , [ Arguments ]
               | "(" , Expression , ")"
               | List | Object ;
Arguments      = "(" , [ Expression , { "," , Expression } , [ "," ] ] , ")" ;
Comprehension  = "(" , Identifier , "," , Expression , ")" ;
List           = "[" , [ Expression , { "," , Expression } , [ "," ] ] , "]" ;
Object         = "{" , [ Entry , { "," , Entry } , [ "," ] ] , "}" ;
Entry          = ( Identifier | Keyword | String ) , ":" , Expression ;
PropertyName   = Identifier | Keyword ;

Identifier     = IdentStart , { IdentStart | Digit } - Keyword ;
IdentStart     = "A" … "Z" | "a" … "z" | "_" | "$" ;
Keyword        = "true" | "false" | "null" | "in" ;
Digit          = "0" … "9" ;
Number         = ( Digit , { Digit } , [ "." , Digit , { Digit } ] | "." , Digit , { Digit } ) , [ Exponent ] ;
Exponent       = ( "e" | "E" ) , [ "+" | "-" ] , Digit , { Digit } ;
String         = "'" , { Char - "'" | Escape } , "'" | '"' , { Char - '"' | Escape } , '"' ;
Template       = "`" , { Char - "`" - "${" | Escape | "${" , Expression , "}" } , "`" ;
Escape         = "\" , Char ;
```

Rules the EBNF does not carry:

- **Tokens are longest match**: `<=` is one token, not `<` then `=`. A word is an `Identifier` unless
  it is a `Keyword`.
- **Binary operators associate to the left**, at the precedence the productions give, loosest first:
  `?:`, `??`, `||`, `&&`, `== !=`, `< > <= >= in`, `+ -`, `* / %`, unary `! -`, then member, index
  and call. The conditional associates to the right.
- **A call** is written only on an identifier (`f(x)`) or as a member (`x.f(y)`); `x.f(y)` is the
  same call as `f(x, y)`. No other value can be called.
- **A comprehension** is a member whose name is `filter`, `map`, `find`, `exists` or `all` and whose
  first argument is a bare identifier followed by a comma: `items.filter(x, x.done)`. Any other shape
  (`items.filter({ done: true })`) is an ordinary call.
- **An exponent** is part of a number only when a digit follows `e`, `E`, `e+` or `e-`; otherwise
  the number ends before the `e`.
- **Escapes**, in strings and templates: `\n`, `\t`, `\r` are line feed, tab and carriage return;
  `\` before any other character is that character (`\\`, `\'`, `\"`, `` \` ``, `\$`).
- **A template hole** `${…}` holds a full expression, which may itself contain strings, templates and
  braces; the hole ends at the `}` that balances its `{`.
- **Denied names.** `__proto__`, `constructor` and `prototype` MUST be refused as a property name
  after `.`, as an object key, and as a literal string index; read any other way they give no value.
- **Limits.** An expression longer than 4,000 UTF-16 code units, or nested more than 40 levels (each
  conditional, unary operator, call, parenthesis, list and object is a level), MAY be refused. An
  implementation MUST accept anything within both limits.

There is no assignment, no statement, no function definition and no way to read a value's own
methods. No syntax is added in minor versions; a new capability is a [core function](#core-functions).

## Evaluation

Evaluation is **total**: no expression that parses and reads only bound names fails at run time.
Wrong-typed input gives the empty value of the expected kind (`[]`, `''`, `0`, `false`, no value).

| Form                 | Value                                                                                                                                                                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| literal              | Itself. A number literal is the nearest double to its decimal text.                                                                                                                                                                                                                                                  |
| `name`               | The bound value. (Unbound names are refused before evaluation: [Names](execution.md#names-and-scope).)                                                                                                                                                                                                               |
| `a.name`             | On an object, its value under `name`, or no value. On a list or text, `length` is its length and any other name is no value. Otherwise no value.                                                                                                                                                                     |
| `a[i]`               | With a number `i`: on a list, the entry at `i`; on text, the code unit at `i` as text; no value when `i` is not a whole number in range, and on anything else. With any other `i`: as `a.name`, with `i` converted to text (so `list['0']` is the first entry, and `record['title']` its title).                     |
| `` `…${e}…` ``       | The literal runs and each hole converted to text, concatenated.                                                                                                                                                                                                                                                      |
| `[a, b]`             | A list of the values.                                                                                                                                                                                                                                                                                                |
| `{ k: v }`           | An object; a later duplicate key wins.                                                                                                                                                                                                                                                                               |
| `!a`                 | `true` when `a` is falsy, else `false`.                                                                                                                                                                                                                                                                              |
| `-a`                 | The negation of `a` converted to a number (so `-missing` is `0`, as `missing * 2` is).                                                                                                                                                                                                                               |
| `a && b`             | `false` when `a` is falsy (and `b` is not evaluated); else whether `b` is truthy. Always a boolean.                                                                                                                                                                                                                  |
| `a \|\| b`           | `true` when `a` is truthy (and `b` is not evaluated); else whether `b` is truthy. Always a boolean.                                                                                                                                                                                                                  |
| `a ?? b`             | `a` unless it is no value or `null`, in which case `b` (evaluated only then).                                                                                                                                                                                                                                        |
| `a == b`, `a != b`   | Strict equality: the same kind and the same value. Numbers compare as doubles (NaN equals nothing, `0 == -0`); text by code units; no value equals only no value; `null` only `null`. A list or an object equals only itself (the same value reached twice), never a separately built one.                           |
| `<`, `>`, `<=`, `>=` | When both sides read as numbers, compared as numbers (`'3' < '10'` is `true`). Otherwise, when both are text, compared in code point order (`'b' < 'c'` is `true`, and ISO dates order by time). Otherwise `false`: no value, `null`, a boolean, a list, an object, or a number beside non-numeral text (`3 < 'b'`). |
| `a in b`             | `true` when `b` is a list with an entry equal to `a` by `==` (except that NaN is in a list holding NaN). `false` when `b` is not a list.                                                                                                                                                                             |
| `a + b`              | Either text: both converted to text and joined. Otherwise both converted to numbers and summed (`true + 1` is `1`, `[2] + 1` is `1`).                                                                                                                                                                                |
| `a - b`, `a * b`     | Both converted to numbers.                                                                                                                                                                                                                                                                                           |
| `a / b`, `a % b`     | Both converted to numbers; a divisor of `0` gives `0`. `%` is the remainder with the sign of `a`.                                                                                                                                                                                                                    |
| `t ? a : b`          | `a` when `t` is truthy, else `b`; only the chosen side is evaluated.                                                                                                                                                                                                                                                 |
| `f(…)`, `x.f(…)`     | The core function's result ([Core functions](#core-functions)). Arguments are evaluated left to right; `x.f(y)` passes `x` first. Missing optional arguments are no value.                                                                                                                                           |

An operation's expressions read only the names [Execution](execution.md#names-and-scope) binds; a
value read from a record is data, and reading a field never runs anything.

### Comprehensions

`list.filter(x, body)`, `list.map(x, body)`, `list.find(x, body)`, `list.exists(x, body)` and
`list.all(x, body)` evaluate `body` once per entry, in order, with `x` bound to the entry; `x`
shadows any name of the same spelling within `body`.

| Name     | Over a list                                             | Over anything else                                                        |
| -------- | ------------------------------------------------------- | ------------------------------------------------------------------------- |
| `filter` | The entries whose body is truthy.                       | `[]`                                                                      |
| `map`    | The body's values.                                      | An object: the body's value for that object (not a list). Otherwise `[]`. |
| `find`   | The first entry whose body is truthy, or no value.      | No value.                                                                 |
| `exists` | Whether any entry's body is truthy.                     | `false`                                                                   |
| `all`    | Whether every entry's body is truthy (`true` for `[]`). | `true`                                                                    |

## The where-object

A where-object selects records. It is the `where` of a `find` ([Format](format.md#find)), read by
the backend, and the `where` argument of `filter` and `find` below, read by the expression language;
both MUST mean the same.

Each key of a where-object is a field name or a combinator, and every key must hold for a record to
match. For a field `f` holding a condition `c`:

| `c`                               | Matches when the record's `f`…                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| a scalar `v`                      | equals `v` (strict).                                                                                                                              |
| a list `[v, …]`                   | equals one of them. `[]` matches nothing.                                                                                                         |
| `{ "not": v }`                    | does not equal `v`.                                                                                                                               |
| `{ "not": [v, …] }`               | equals none of them.                                                                                                                              |
| `{ "contains": t }`               | contains `t`, ignoring case.                                                                                                                      |
| `{ "startsWith": t }`             | starts with `t`, case-sensitively.                                                                                                                |
| `{ "endsWith": t }`               | ends with `t`, case-sensitively.                                                                                                                  |
| `{ "gt": v }`, `gte`, `lt`, `lte` | compares so with `v`: both numbers, or both text compared by UTF-16 code units. A mixed pair never matches. Several bounds on one field all hold. |
| `{ "exists": false }`             | has no value. Any other `exists` operand: has a value.                                                                                            |
| `{ "some": w }`                   | (a relation) has at least one member matching where-object `w`; `{}` is any.                                                                      |
| `{ "none": w }`                   | (a relation) has no member matching `w`; `{ "none": {} }` is "has none".                                                                          |

A condition object is read by the first operator it holds, in this order: `some`, `none`,
`contains`, `startsWith`, `endsWith`, `exists`, the range bounds, `not`. An object holding none of
them is compared as a value, and so matches nothing.

Combinators: `{ "AND": [w, …] }` (all hold; `[]` always holds), `{ "OR": [w, …] }` (at least one
holds; `[]` never holds), `{ "NOT": w }` (`w` does not hold, so `{ "NOT": { "f": "x" } }` matches a
record with no `f`). An `AND` or `OR` that is not a list, or a `NOT` that is not an object, matches
nothing.

**No value matches nothing.** A field with no value (absent, `null` or `''`) matches no condition
but `exists: false`: not `v`, not `{ not: v }`, not a list, not a range, not a text match. Text
matches read a number, a boolean or a list as its text, and an object as having no text.

In `filter` and `find` (the functions), a list item that is not an object has no fields, and a
`some`/`none` condition matches nothing, since a plain value has no relations to follow.

> **Planned.** `exists`, `startsWith`, `endsWith` and text range bounds are not yet guaranteed by
> every backend in a `find`'s where. A portable `find` SHOULD keep to equality, lists, `not`,
> `contains`, numeric ranges, `some`/`none` and the combinators until a later version requires the
> rest.

## Core functions

Every function below is core: an implementation of this spec MUST provide each with exactly the
behaviour given, and MUST NOT provide any other to an operation. A call to a name outside this list,
or with an argument count its signature does not allow, is a static error
([Static checks](format.md#static-checks)).

Signatures: `name?` is optional, `...name` takes any number (including none). Every function is
pure and total. Unless an entry says otherwise, "not a list" reads as `[]`, "not an object" as `{}`,
and text arguments are converted to text.

**Identity** (used by `distinct`, `without`, `indexOf`, `insertAfter`): an object with an `id` other
than no value is identified by its `id`; anything else by itself. Two identities are the same when
they are `==`, or both NaN. So a record and its id name the same entry.

**Code point order** (used by `<` and its kin, `sortBy`, `keys`, `values`, `put`, `merge`): text
compared by Unicode code point, first difference deciding, a shorter prefix first. Not by locale.

**An object's fields** (used by `keys`, `values`, `put`, `merge`): its keys in code point order,
leaving out any key whose value is no value. A key holding `null` is a field: `null` is how a field
set says "clear this field" (as `''` is), so it is kept, listed and returned like any other value.

### Lists

| Signature                           | Result                                                                                                                                                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `count(items)`                      | The number of entries. Not a list: `0`.                                                                                                                                                                                                |
| `sum(items)`                        | The entries converted to numbers, added (an entry that reads as no number adds `0`). Not a list: `0`.                                                                                                                                  |
| `first(items)`                      | The first entry, or no value.                                                                                                                                                                                                          |
| `last(items)`                       | The last entry, or no value.                                                                                                                                                                                                           |
| `reverse(items)`                    | A new list, back to front.                                                                                                                                                                                                             |
| `filter(items, where, limit?)`      | The entries matching `where` ([The where-object](#the-where-object)). A `where` that is not an object keeps every entry. A `limit` that is a number ≥ 0 keeps the first `limit` (truncated toward zero); any other `limit` is ignored. |
| `find(items, where?)`               | The first entry matching `where`, or no value. A `where` that is absent or not an object gives the first entry.                                                                                                                        |
| `distinct(...lists)`                | The entries of every list, in order, each identity kept once (the first seen).                                                                                                                                                         |
| `concat(...lists)`                  | The entries of every list, in order, duplicates kept.                                                                                                                                                                                  |
| `without(items, ...values)`         | The entries whose identity is not that of any of `values`.                                                                                                                                                                             |
| `indexOf(items, value)`             | The position of the first entry with `value`'s identity, from 0, or `-1`.                                                                                                                                                              |
| `insertAt(items, index, value)`     | A new list with `value` at `index`: `index` converted to a number, truncated toward zero, and held between `0` and the length (so a negative index puts it first). `value` no value or `null`: the list unchanged.                     |
| `insertAfter(items, anchor, value)` | A new list with `value` straight after the first entry with `anchor`'s identity, or at the end when there is none. `value` no value or `null`: the list unchanged.                                                                     |
| `slice(items, start, end?)`         | The entries from `start` up to, not including, `end` (default: the length). Each converted to a number and truncated toward zero; a negative position counts back from the end; positions are held within the list.                    |
| `sortBy(items, key, direction?)`    | A new list ordered by the field `key` names, see below.                                                                                                                                                                                |
| `join(items, separator?)`           | The entries converted to text, joined by `separator` converted to text (default, when it is no value, `', '`; `null` is `''`).                                                                                                         |
| `split(text, separator?)`           | `text` cut at each occurrence of `separator` converted to text (default, when it is no value, `','`), each piece trimmed as `trim` does, empty pieces left out. An empty separator, or `null`, cuts between every code unit.           |

**`sortBy(items, key, direction?)`.** `key` is a dot path (`'createdAt'`, `'author.name'`), read field
by field; a step through anything but an object gives no value. A `key` that is not text, or is
`''`, gives a copy of the list unchanged. An entry whose value is no value, `null`, `''` or NaN is
_unsorted_. The sort is stable, and:

- unsorted entries go after every other entry, keeping their order, whatever the direction;
- among the rest, values rank numbers, then text, then booleans, then anything else; numbers compare
  numerically, text in code point order, `false` before `true`, and values ranked "anything else"
  compare equal;
- `direction` `'desc'` reverses that whole order (ranks included); any other value is `'asc'`.

### Text

| Signature                   | Result                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `lower(text)`               | Lower case, by Unicode default case mapping (not locale-sensitive).                                                              |
| `upper(text)`               | Upper case, likewise.                                                                                                            |
| `trim(text)`                | Without leading and trailing white space (ECMAScript's `WhiteSpace` and `LineTerminator` characters).                            |
| `contains(text, needle)`    | Whether `lower(text)` contains `lower(needle)`. An empty needle is contained in anything.                                        |
| `startsWith(text, prefix)`  | Whether `text` starts with `prefix`, case-sensitively.                                                                           |
| `endsWith(text, suffix)`    | Whether `text` ends with `suffix`, case-sensitively.                                                                             |
| `plural(count, one, other)` | `one` when `count` is exactly 1 by ECMAScript `Number()` (so `'1'` counts), otherwise `other`. Returned as given, not converted. |
| `slug(text)`                | See below.                                                                                                                       |

**`slug(text)`.** Text is itself and a finite number is its text; anything else gives `''`. Then, in
order: lower case it as `lower` does; drop every character that is not `a`–`z`, `0`–`9`, `-` or
white space; trim it as `trim` does; replace each run of white space with one `-`. Nothing is folded:
`'Café au lait'` is `'caf-au-lait'`, and `'a - b'` is `'a---b'`.

### Numbers

| Signature               | Result                                                                                                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `round(value, digits?)` | `value` (converted to a number) rounded to `digits` decimal places: `d` = `digits` converted to a number, floored, at least 0; the result is `roundHalfUp(value × 10^d) / 10^d` in doubles, where halves round toward +∞ (`round(-2.5)` is `-2`).   |
| `min(...values)`        | The smallest of the values converted to numbers. A single argument that is a list stands for its entries (`min([3, 1, 2])` is `1`); a list among several arguments is a value that reads as no number, so `0`. `0` with no values or an empty list. |
| `max(...values)`        | The largest, by the same rules.                                                                                                                                                                                                                     |

### Objects

| Signature                 | Result                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pick(object, keys)`      | A new object with each key in the list `keys` (converted to text) whose value in `object` is not no value. Not an object: `{}`.                                                                                                       |
| `put(object, key, value)` | A new object: `object`'s fields, with `key` set to `value` (`null` included), or removed when `value` is no value. `key` is text, or a finite number as its text; any other key, or a denied name, gives `object`'s fields unchanged. |
| `merge(...objects)`       | A new object of every object's fields, a later one winning a shared key. Shallow. A key holding `null` overrides (a clear survives the merge); a key with no value does not.                                                          |
| `keys(object)`            | `object`'s field names, in code point order, a key holding `null` or `''` included.                                                                                                                                                   |
| `values(object)`          | `object`'s field values, in the order `keys` gives, `null` included.                                                                                                                                                                  |

> **Why these functions.** The list and object builders exist because an operation writes a
> relation's whole list or a `json` field's whole value, and so has to compute the new one from the
> old. `sortBy`, `keys` and `values` fix their order by code point so a stored order is the same on
> every host. There is no `now()`: the time is `invokedAt`.

## Relation to CEL

The subset is close to the Common Expression Language (CEL) in its shape, and a reader who knows CEL
can read most expressions on sight. It is not CEL, and a CEL engine does not evaluate it: where the
two differ, an expression that is correct here is an error in CEL or means something else. This
section says which, so that nobody treats one as the other. It is informative; the rules above are
the ones that hold.

**Where they agree.**

- **The surface.** Literals for `null`, booleans, numbers, strings, lists and maps; member access
  with `.` and indexing with `[]`; `!`, `&&`, `||`, `? :`, the comparisons, `in`, and `+ - * / %`; a
  function called as `f(x, y)` or on its receiver as `x.f(y)`. `true`, `false`, `null` and `in` are
  reserved words in both.
- **The list macros.** `list.filter(x, body)`, `list.map(x, body)`, `list.exists(x, body)` and
  `list.all(x, body)` bind `x` to each entry in turn and mean what CEL's macros of the same names
  mean over a list: the entries whose body holds, the bodies' values, whether any holds, whether all
  hold (`all` of an empty list is true). `find` is this subset's own; CEL has `exists_one` instead,
  which this subset does not have.
- **No side effects, nothing but the names given.** An expression reads its bindings and calls pure
  functions, and the host decides what is bound, as with a CEL environment.
- **`contains`, `startsWith`, `endsWith`** exist in both, as functions on text.

**Where they differ.**

- **Totality.** CEL evaluates to a value or an error: a missing map key, a field of `null`, a
  division by zero, an overflow, an operand of the wrong type (`1 + 'a'`) are errors, which `&&` and
  `||` can absorb. Here nothing that parses and reads bound names fails at run time
  ([Evaluation](#evaluation)): wrong-typed input gives the empty value of its kind, `/` and `%` by
  zero give `0`, and a list joins text as text.
- **Absent values.** CEL has no "no value": reading a key a map lacks is an error, and `has()` asks
  first. Here a missing field is **no value**, distinct from `null` to `==` and the same as it to
  `??` ([Values](#values)), and the data model reads `''` as no value as well
  ([The absent-value rule](README.md#the-absent-value-rule)). There is no `has()`; `x ?? d`, `!x`
  and `exists` in a where-object ask instead. CEL has no `??` (its optional values are an extension).
- **Truthiness.** CEL's `!`, `&&`, `||` and `? :` take booleans only, and anything else is an error.
  Here every value is truthy or falsy ([Truthiness](#truthiness)); `&&` and `||` still answer with a
  boolean, as CEL's do.
- **The number rule.** CEL has `int`, `uint` and `double` as separate types, with integer
  arithmetic that errors on overflow. Here every number is a double, and text that is wholly a
  numeral reads as a number in comparisons and arithmetic ([Conversions](#conversions)), so `'3' < '10'`
  is true here and false in CEL, which compares text as text. `+` with text on either side joins
  text here and is a type error in CEL unless both sides are text.
- **Text.** CEL measures text in code points; here length and indexing are in UTF-16 code units
  ([Text is UTF-16](#text-is-utf-16)). `contains` ignores case here and does not in CEL.
- **Interpolation.** `` `…${e}…` `` is this subset's own; CEL has no string templates.
- **Equality of lists and maps.** CEL compares them by value; here a list or an object equals only
  itself, and `distinct`, `without` and `indexOf` compare records by `id` ([Core functions](#core-functions)).
- **The where-object.** `filter(items, where)` and `find(items, where)` take the same where-object a
  `find` step sends to the backend ([The where-object](#the-where-object)), so one grammar selects
  records in both places. CEL has no counterpart; its macros take only an expression body.
- **The library.** Of the core functions, CEL's language definition has `contains`, `startsWith`
  and `endsWith`, and `size` where this subset has `count` and `.length`. The rest (`concat`,
  `distinct`, `first`, `last`, `indexOf`, `insertAfter`, `insertAt`, `join`, `reverse`, `slice`,
  `sortBy`, `split`, `sum`, `without`, `lower`, `upper`, `plural`, `slug`, `trim`, `min`, `max`,
  `round`, `keys`, `values`, `merge`, `pick`, `put`) are not in it. Some have counterparts in CEL
  implementations' extension libraries, with CEL's error rules rather than these, and with their own
  names and argument orders; `sortBy`, `keys` and `values` here fix their order by code point so a
  stored order is the same on every host ([Code point order](#core-functions)).

> **Why not CEL.** An operation's expressions decide what is written, and a failure part-way through
> a write has to be a failure of the whole operation, which the runner reports as a named error. An
> expression language that can fail in the middle of computing a field would give every operation a
> second, implicit error path. The absent-value rule is the data model's, and an expression language
> that made a missing field an error would contradict it at every read.

---

Implemented by: [`lexer.ts`](../../../packages/schema-system/expressions/src/lexer.ts),
[`parser.ts`](../../../packages/schema-system/expressions/src/parser.ts),
[`evaluate.ts`](../../../packages/schema-system/expressions/src/evaluate.ts),
[`check.ts`](../../../packages/schema-system/expressions/src/check.ts) (`functions: 'core'`),
[`functions.ts`](../../../packages/schema-system/expressions/src/functions.ts) (`CORE_FUNCTIONS`),
[`where.ts`](../../../packages/schema-system/expressions/src/where.ts),
[`whereMatch.ts`](../../../packages/backend-system/shared/src/whereMatch.ts),
[`queryCompiler.ts`](../../../packages/backend-system/shared/src/queryCompiler.ts) (`leafFilter`).
Pinned by: [`expressions.test.ts`](../../../packages/schema-system/expressions/src/expressions.test.ts)
("parsing and printing", "evaluation", "the functions a declared operation builds its writes with",
"the core subset"), and the cases marked `core` in the template suite's
[`expressions.json`](../../../packages/schema-system/conformance/vectors/expressions.json) and
[`functions.json`](../../../packages/schema-system/conformance/vectors/functions.json) (`eval.core-*`,
[Conformance](conformance.md#the-core-subset-expression-vectors)).
