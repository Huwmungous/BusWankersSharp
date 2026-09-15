var builder = WebApplication.CreateBuilder(args);

// Add services to the container.

builder.Services.AddControllers();
// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// The frontend is served same-origin through holly's nginx path-based proxy
// (https://longmanrd.net/buswankers-api/ -> this service), so no browser actually
// needs CORS for that route. This stays permissive only so `npm start`'s dev server
// (a different origin/port) can hit a locally-run copy of this service while
// developing the upload page - the real gate is the password check in the
// controller, not the browser's origin, so relaxing CORS doesn't weaken that.
const string DevCorsPolicy = "DevCors";
builder.Services.AddCors(options =>
{
    options.AddPolicy(DevCorsPolicy, policy =>
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());
});

var app = builder.Build();

// Configure the HTTP request pipeline.
if(app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors(DevCorsPolicy);

// Deliberately no UseHttpsRedirection(): this service only ever listens on plain
// HTTP behind holly's nginx, which terminates TLS for https://longmanrd.net/ and
// reverse-proxies to it over the LAN - redirecting to HTTPS here would just break
// that proxied traffic.

app.UseAuthorization();

app.MapControllers();

app.Run();
