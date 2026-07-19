//! Compile the gateway .proto files with protox (pure Rust — no protoc binary
//! needed on dev machines or CI) and generate tonic server/client code.

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let protos = [
        "proto/quartzcommand/enrollment/v1/enrollment.proto",
        "proto/quartzcommand/device/v1/device.proto",
    ];
    for p in &protos {
        println!("cargo:rerun-if-changed={p}");
    }

    let fds = protox::compile(protos, ["proto"])?;
    // Client code is generated too: the enrollment tests act as a device.
    tonic_build::configure().compile_fds(fds)?;
    Ok(())
}
