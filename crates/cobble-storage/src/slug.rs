/// Turns a page title into a filesystem-safe, human-browsable slug. Uniqueness
/// is never this function's job — the caller always appends the page's ULID,
/// so a degenerate slug (empty, non-ASCII-only) only costs readability, never
/// correctness.
pub fn slugify(title: &str) -> String {
    const MAX_LEN: usize = 60;

    let mut slug = String::new();
    let mut last_was_dash = true; // suppresses a leading dash
    for ch in title.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_was_dash = false;
        } else if !last_was_dash {
            slug.push('-');
            last_was_dash = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.len() > MAX_LEN {
        slug.truncate(MAX_LEN);
        while slug.ends_with('-') {
            slug.pop();
        }
    }

    if slug.is_empty() {
        "untitled".to_string()
    } else {
        slug
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lowercases_and_hyphenates() {
        assert_eq!(slugify("Q3 Planning"), "q3-planning");
    }

    #[test]
    fn collapses_runs_of_punctuation() {
        assert_eq!(slugify("Hello,   World!!"), "hello-world");
    }

    #[test]
    fn falls_back_to_untitled_when_nothing_ascii_survives() {
        assert_eq!(slugify(""), "untitled");
        assert_eq!(slugify("🗂️"), "untitled");
        assert_eq!(slugify("日本語"), "untitled");
    }

    #[test]
    fn truncates_long_titles_without_a_trailing_dash() {
        let long_title = "word ".repeat(30);
        let slug = slugify(&long_title);
        assert!(slug.len() <= 60);
        assert!(!slug.ends_with('-'));
    }
}
