using Microsoft.AspNetCore.Mvc;

namespace GenerateAutofills.Controllers
{
    public enum AFType { ftNone, ftBus, ftGeneral };

    [Route("[controller]")]
    [ApiController]
    public class AutofillsController : ControllerBase
    {
        [HttpGet]
        public async Task<string> GetAutofill(AFType autoFillType)
        {
            string result = "";

            await Task.Run(() => {
                switch (autoFillType)
                {
                    case AFType.ftNone: result = ""; break;
                    case AFType.ftBus: result = ""; break;
                    case AFType.ftGeneral: result = ""; break;
                }
            });

            return result;
        }

        [HttpPost]
        public async Task<IActionResult> Post(IFormFile file)
        {
            if (file == null || file.Length == 0)
            {
                return BadRequest("Upload a file.");
            }

            var path = Path.Combine(Directory.GetCurrentDirectory(), "uploads", file.FileName);

            using (var stream = new FileStream(path, FileMode.Create))
            {
                await file.CopyToAsync(stream);
            }

            return Ok(new { file.FileName, file.Length });
        }
    }
}