var builder = WebApplication.CreateBuilder(args);

builder.Services.AddEndpointsApiExplorer();

builder.Services.AddSwaggerGen();

// Add services to the container.

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        // Allow requests from the specific domain where your client is hosted
        policy.WithOrigins(
            "https://longmanrd.net",
            "http://longmanrd.net",
            "https://localhost:5000",
            "http://localhost:5000"
            )
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

builder.Services.AddControllers();

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();

// Use CORS
app.UseCors();

// Map controllers
app.MapControllers();

app.Run();
