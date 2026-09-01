use crate::id::BlockId;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// The full block-type vocabulary committed to in `docs/ARCHITECTURE.md`'s
/// "Content model" decision. Not every variant has an editor implementation
/// yet (M1 ships paragraph/heading/todo/divider; the rest land in M2) — the
/// type is defined up front so the on-disk schema and `BlockId` stability
/// guarantee don't change shape later.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockType {
    Paragraph,
    Heading,
    Todo,
    Toggle,
    Quote,
    Code,
    Divider,
    Table,
    Image,
    SubPage,
    PluginBlock,
}

/// Inline formatting mark on a run of text within a block's `content`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Mark {
    Bold,
    Italic,
    Strikethrough,
    Code,
    Link { href: String },
}

/// A run of text sharing the same marks. `Block::content` is a sequence of
/// these, mirroring Lexical's text-node model so
/// `frontend/src/editor/serialization.ts` can map one-to-one onto this shape.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct InlineSpan {
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub marks: Vec<Mark>,
}

/// One block. `attrs` carries type-specific data (e.g. `checked` for `todo`,
/// `language` for `code`; for `plugin_block`, `{plugin_id, block_type, data}`
/// per the on-disk format doc) — kept as a loose JSON object here rather than
/// a per-type Rust shape so unknown/future attrs round-trip untouched instead
/// of being dropped by a strict struct.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Block {
    pub id: BlockId,
    #[serde(rename = "type")]
    pub block_type: BlockType,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub attrs: Map<String, Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content: Vec<InlineSpan>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<Block>,
}

impl Block {
    pub fn new(block_type: BlockType) -> Self {
        Self {
            id: BlockId::new(),
            block_type,
            attrs: Map::new(),
            content: Vec::new(),
            children: Vec::new(),
        }
    }

    pub fn with_text(mut self, text: impl Into<String>) -> Self {
        self.content = vec![InlineSpan {
            text: text.into(),
            marks: Vec::new(),
        }];
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_paragraph_through_json() {
        let block = Block::new(BlockType::Paragraph).with_text("hello world");
        let json = serde_json::to_string(&block).unwrap();
        let back: Block = serde_json::from_str(&json).unwrap();
        assert_eq!(back, block);
    }

    #[test]
    fn plugin_block_attrs_round_trip_untouched() {
        let mut block = Block::new(BlockType::PluginBlock);
        block.attrs.insert(
            "plugin_id".into(),
            Value::String("hello-world".into()),
        );
        block
            .attrs
            .insert("block_type".into(), Value::String("counter".into()));
        block
            .attrs
            .insert("data".into(), serde_json::json!({ "count": 3 }));

        let json = serde_json::to_string(&block).unwrap();
        let back: Block = serde_json::from_str(&json).unwrap();
        assert_eq!(back, block);
    }

    #[test]
    fn nested_children_round_trip() {
        let child = Block::new(BlockType::Todo).with_text("sub-item");
        let mut parent = Block::new(BlockType::Toggle).with_text("parent");
        parent.children.push(child);

        let json = serde_json::to_string(&parent).unwrap();
        let back: Block = serde_json::from_str(&json).unwrap();
        assert_eq!(back, parent);
    }

    #[test]
    fn block_type_serializes_snake_case() {
        assert_eq!(
            serde_json::to_string(&BlockType::SubPage).unwrap(),
            "\"sub_page\""
        );
        assert_eq!(
            serde_json::to_string(&BlockType::PluginBlock).unwrap(),
            "\"plugin_block\""
        );
    }
}
