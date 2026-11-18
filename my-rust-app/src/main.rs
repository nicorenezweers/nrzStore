use axum::{
    routing::get,
    Router,
};
use std::net::SocketAddr;
use tower_http::services::ServeDir;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let app = Router::new()
        .route("/", get(|| async { "Hello from My Rust App!" }))
        .route("/health", get(|| async { "OK" }))
        .fallback_service(ServeDir::new("data"));

    let port = std::env::var("PORT").unwrap_or_else(|_| "44544".to_string());
    let addr = format!("0.0.0.0:{}", port).parse::<SocketAddr>().unwrap();

    println!("Listening on {}", addr);
    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
}