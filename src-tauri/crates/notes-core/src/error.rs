use thiserror::Error;

#[derive(Debug, Error)]
pub enum NoteError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid frontmatter: {0}")]
    Yaml(String),
    #[error("note file is missing an id")]
    MissingId,
    #[error("note not found: {0}")]
    NotFound(String),
    #[error("{0}")]
    Unknown(String),
}

pub type Result<T> = std::result::Result<T, NoteError>;
