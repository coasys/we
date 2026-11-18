//! A fixture (or a `model_query` ingest) as the graph's `context.query`.
//!
//! Rows are flat: `id`, scalar fields, `author`, `createdAt`. An included
//! relation is a hydrated object when the target record exists, otherwise
//! the bare id. Cardinality `many` is an array. Cardinality `one` is one
//! value or `null`. A hydrated object carries `__subjectClass`.
//!
//! Record order is the fixture array order. The seed queries do not pass
//! `order`, and the in-memory backend's default order is not what this
//! fixture recorded, so the array order is the order the graph sees.

use std::collections::HashMap;

use serde::Deserialize;
use serde_json::{Map, Value};

use crate::address::NODE_TYPE_KEY;
use crate::shape::{shape_named, Shape};

#[derive(Debug, Clone)]
pub struct Record {
    pub id: String,
    pub entity: String,
    pub author: Option<String>,
    pub created_at: Option<String>,
    pub fields: Map<String, Value>,
    /// Relation name → member ids, in the order the fixture stored them.
    pub relations: HashMap<String, Vec<String>>,
}

#[derive(Debug, Clone)]
pub struct World {
    records: Vec<Record>,
    by_id: HashMap<String, usize>,
}

/// One relation to hydrate, plus the includes to apply to each member.
#[derive(Debug, Clone)]
pub struct Include {
    pub name: String,
    pub nested: Vec<Include>,
}

#[derive(Debug, Clone)]
pub struct Query {
    pub entity: String,
    pub id: Option<String>,
    pub limit: Option<usize>,
    pub include: Vec<Include>,
}

impl World {
    pub fn from_records(records: Vec<Record>) -> Self {
        let by_id = records
            .iter()
            .enumerate()
            .map(|(i, r)| (r.id.clone(), i))
            .collect();
        Self { records, by_id }
    }

    /// `fixtures/coasys/fixture.json`.
    pub fn coasys_fixture() -> Self {
        Self::from_fixture_json(include_str!("../../fixtures/coasys/fixture.json"))
            .expect("coasys fixture")
    }

    pub fn from_fixture_json(text: &str) -> Result<Self, String> {
        let file: FixtureFile = serde_json::from_str(text).map_err(|e| e.to_string())?;
        Ok(Self::from_records(
            file.records.into_iter().map(Record::from_raw).collect(),
        ))
    }

    pub fn get(&self, id: &str) -> Option<&Record> {
        self.by_id.get(id).map(|&i| &self.records[i])
    }

    /// The read an expander asks for. `where` other than `id` is not used by the three views.
    pub fn query(&self, shapes: &[Shape], q: &Query) -> Vec<Value> {
        let mut rows: Vec<&Record> = self
            .records
            .iter()
            .filter(|r| r.entity == q.entity)
            .filter(|r| q.id.as_ref().is_none_or(|id| &r.id == id))
            .collect();
        if let Some(limit) = q.limit {
            rows.truncate(limit);
        }
        rows.into_iter()
            .map(|r| self.project(shapes, r, &q.include))
            .collect()
    }

    fn project(&self, shapes: &[Shape], record: &Record, include: &[Include]) -> Value {
        let mut row = Map::new();
        row.insert("id".into(), Value::String(record.id.clone()));
        for (k, v) in &record.fields {
            row.insert(k.clone(), v.clone());
        }
        if let Some(author) = &record.author {
            row.insert("author".into(), Value::String(author.clone()));
        }
        if let Some(at) = &record.created_at {
            row.insert("createdAt".into(), Value::String(at.clone()));
        }
        let shape = shape_named(shapes, &record.entity);
        for inc in include {
            let rel = shape.and_then(|s| s.relation(&inc.name));
            let ids = record
                .relations
                .get(&inc.name)
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            let many = rel.is_none_or(|r| r.cardinality == "many");
            let hydrated: Vec<Value> = ids
                .iter()
                .map(|id| match self.get(id) {
                    Some(child) => {
                        let mut child_row = match self.project(shapes, child, &inc.nested) {
                            Value::Object(m) => m,
                            other => {
                                let mut m = Map::new();
                                m.insert("id".into(), other);
                                m
                            }
                        };
                        child_row.insert(NODE_TYPE_KEY.into(), Value::String(child.entity.clone()));
                        Value::Object(child_row)
                    }
                    None => Value::String(id.clone()),
                })
                .collect();
            let value = if many {
                Value::Array(hydrated)
            } else {
                hydrated.into_iter().next().unwrap_or(Value::Null)
            };
            row.insert(inc.name.clone(), value);
        }
        Value::Object(row)
    }
}

impl Record {
    fn from_raw(raw: RawRecord) -> Self {
        let mut relations = HashMap::new();
        for (name, value) in raw.relations {
            relations.insert(name, ids_of(&value));
        }
        Self {
            id: raw.id,
            entity: raw.entity,
            author: raw.author,
            created_at: raw.created_at,
            fields: raw.fields,
            relations,
        }
    }

    /// One `model_query` instance, split into scalars and relation ids by `shape`.
    pub fn from_instance(entity: &str, instance: &Value, shape: Option<&Shape>) -> Option<Self> {
        let obj = instance.as_object()?;
        let id = obj.get("id").and_then(Value::as_str)?.to_string();
        let mut fields = Map::new();
        let mut relations = HashMap::new();
        for (k, v) in obj {
            if k == "id" || k == NODE_TYPE_KEY {
                continue;
            }
            if shape.is_some_and(|s| s.relation(k).is_some()) {
                relations.insert(k.clone(), ids_of(v));
            } else if is_scalar(v) {
                fields.insert(k.clone(), v.clone());
            }
        }
        let author = fields
            .get("author")
            .and_then(Value::as_str)
            .map(str::to_string);
        let created_at = fields
            .get("createdAt")
            .and_then(Value::as_str)
            .map(str::to_string);
        let _ = entity;
        Some(Self {
            id,
            entity: entity.to_string(),
            author,
            created_at,
            fields,
            relations,
        })
    }
}

fn is_scalar(v: &Value) -> bool {
    matches!(
        v,
        Value::Null | Value::String(_) | Value::Number(_) | Value::Bool(_)
    )
}

fn ids_of(value: &Value) -> Vec<String> {
    match value {
        Value::String(s) => vec![s.clone()],
        Value::Array(items) => items.iter().filter_map(id_of).collect(),
        Value::Object(_) => id_of(value).into_iter().collect(),
        _ => Vec::new(),
    }
}

fn id_of(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Object(m) => m.get("id").and_then(Value::as_str).map(str::to_string),
        _ => None,
    }
}

#[derive(Deserialize)]
struct FixtureFile {
    records: Vec<RawRecord>,
}

#[derive(Deserialize)]
struct RawRecord {
    id: String,
    entity: String,
    #[serde(default)]
    author: Option<String>,
    #[serde(rename = "createdAt", default)]
    created_at: Option<String>,
    #[serde(default)]
    fields: Map<String, Value>,
    #[serde(default)]
    relations: Map<String, Value>,
}
