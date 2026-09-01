use serde::{Deserialize, Serialize};
use std::fmt;
use ulid::Ulid;

/// A stable, sortable identifier. Never reused or reassigned once a page or
/// block exists — see "Block IDs are forever" in `CLAUDE.md`.
macro_rules! ulid_id {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub Ulid);

        impl $name {
            pub fn new() -> Self {
                Self(Ulid::new())
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}", self.0)
            }
        }

        impl std::str::FromStr for $name {
            type Err = ulid::DecodeError;

            fn from_str(s: &str) -> Result<Self, Self::Err> {
                Ok(Self(Ulid::from_string(s)?))
            }
        }

        impl From<Ulid> for $name {
            fn from(u: Ulid) -> Self {
                Self(u)
            }
        }
    };
}

ulid_id!(PageId);
ulid_id!(BlockId);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_json_as_a_string() {
        let id = PageId::new();
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(json, format!("\"{}\"", id.0));
        let back: PageId = serde_json::from_str(&json).unwrap();
        assert_eq!(back, id);
    }

    #[test]
    fn parses_from_str() {
        let id = BlockId::new();
        let parsed: BlockId = id.to_string().parse().unwrap();
        assert_eq!(parsed, id);
    }
}
